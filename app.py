import os
os.environ["OPENCV_LOG_LEVEL"] = "OFF"
os.environ["OPENCV_VIDEOIO_PRIORITY_MSMF"] = "0"
import cv2
if hasattr(cv2, 'setLogLevel'):
    try:
        cv2.setLogLevel(0)
    except Exception:
        pass
import csv
import json
import time
import datetime
import threading
from flask import Flask, render_template, Response, jsonify, request, send_file, send_from_directory, session
import pandas as pd
import numpy as np
from dotenv import load_dotenv

load_dotenv()

# Try importing face_recognition; fallback to OpenCV cascade if unavailable
HAVE_FACE_RECOGNITION = False
try:
    import face_recognition
    HAVE_FACE_RECOGNITION = True
    print("[INFO] Successfully imported 'face_recognition' library.")
except ImportError:
    print("[WARNING] 'face_recognition' library not found or missing dlib bindings.")
    print("[INFO] Falling back to OpenCV Haar Cascade face detection.")

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "smart_attendance_secret_key_2026")

# Custom Computer Storage Folder Directory System
CUSTOM_STORAGE_DIR = os.getenv("CUSTOM_STORAGE_DIR", "attendance_data")

def get_storage_subfolder(subname):
    """Returns absolute/relative path for a subfolder inside CUSTOM_STORAGE_DIR."""
    folder_path = os.path.join(CUSTOM_STORAGE_DIR, subname)
    if ALLOW_DISK_STORAGE:
        try:
            os.makedirs(folder_path, exist_ok=True)
        except Exception as err:
            print(f"[WARNING] Could not create storage directory {folder_path}: {err}")
    return folder_path

def get_known_faces_dir():
    code = get_class_code()
    class_faces_dir = os.path.join(CUSTOM_STORAGE_DIR, "known_faces", code)
    if ALLOW_DISK_STORAGE:
        try:
            os.makedirs(class_faces_dir, exist_ok=True)
        except Exception as err:
            print(f"[WARNING] Could not create class faces directory {class_faces_dir}: {err}")
    return class_faces_dir

def get_recordings_dir():
    return get_storage_subfolder("recorded_videos")

def get_class_csv_path():
    """Returns class-isolated CSV file path based on logged-in class account."""
    code = get_class_code()
    csv_dir = get_storage_subfolder("attendance_logs")
    fpath = os.path.join(csv_dir, f"attendance_{code}.csv")
    ensure_csv_file(fpath)
    return fpath

def get_class_roster_path():
    """Returns class-isolated JSON student roster file path."""
    code = get_class_code()
    roster_dir = get_storage_subfolder("class_rosters")
    return os.path.join(roster_dir, f"roster_{code}.json")

# Computer Internal Storage vs Website Only Configurations
ALLOW_DISK_STORAGE = True
STORAGE_MODE = "internal_disk"

# Clock Time Offset System (in minutes)
TIME_OFFSET_MINUTES = 0

def get_current_now():
    """Returns current datetime adjusted by TIME_OFFSET_MINUTES."""
    base_now = datetime.datetime.now()
    if TIME_OFFSET_MINUTES != 0:
        return base_now + datetime.timedelta(minutes=TIME_OFFSET_MINUTES)
    return base_now

# Class Account Credentials
CLASS_ACCOUNTS = {
    "ECE 2YEAR@LAPC": {
        "password": "123456789",
        "class_name": "ECE 2nd Year (LAPC)",
        "code": "ECE2"
    },
    "ECE 3YEAR@LAPC": {
        "password": "123456789",
        "class_name": "ECE 3rd Year (LAPC)",
        "code": "ECE3"
    }
}

def get_class_code():
    """Returns class code for current active session ('ECE2', 'ECE3', or default 'ECE2')."""
    try:
        user_id = session.get('user_id', '')
        if user_id in CLASS_ACCOUNTS:
            return CLASS_ACCOUNTS[user_id].get('code', 'ECE2')
    except RuntimeError:
        # Called outside of Flask HTTP request context (e.g. startup / background threads)
        pass
    return 'ECE2'

def ensure_csv_file(fpath):
    """Ensures specified CSV file exists and has correct columns."""
    if not os.path.exists(fpath) or os.path.getsize(fpath) == 0:
        with open(fpath, mode='w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(CSV_COLUMNS)
    else:
        try:
            df = pd.read_csv(fpath)
            missing = [c for c in CSV_COLUMNS if c not in df.columns]
            if missing:
                for c in missing:
                    df[c] = "-"
                df = df[CSV_COLUMNS]
                df.to_csv(fpath, index=False)
        except Exception:
            pass



# Computer Internal Storage vs Website Only Configurations
ALLOW_DISK_STORAGE = True
STORAGE_MODE = "internal_disk"
in_memory_rosters = {}
in_memory_attendance = {}

def load_class_roster():
    """Loads student name list roster for active logged-in class account."""
    code = get_class_code()
    if code in in_memory_rosters and in_memory_rosters[code]:
        return in_memory_rosters[code]

    rpath = get_class_roster_path()
    if ALLOW_DISK_STORAGE and os.path.exists(rpath):
        try:
            with open(rpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                in_memory_rosters[code] = data
                return data
        except Exception as e:
            print(f"[ERROR] Loading roster {rpath}: {e}")
    return in_memory_rosters.get(code, [])

def save_class_roster(roster_list):
    """Saves student roster list to class-isolated JSON file if disk storage allowed."""
    code = get_class_code()
    in_memory_rosters[code] = roster_list
    if ALLOW_DISK_STORAGE:
        rpath = get_class_roster_path()
        try:
            with open(rpath, 'w', encoding='utf-8') as f:
                json.dump(roster_list, f, indent=2)
        except Exception as e:
            print(f"[ERROR] Saving roster {rpath}: {e}")

# Ensure directories exist if disk storage is enabled
if ALLOW_DISK_STORAGE:
    get_known_faces_dir()
    get_recordings_dir()

# MongoDB Database Configuration
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = "smart_attendance_db"
USE_MONGO = False
db = None

try:
    import pymongo
    client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=1500)
    client.admin.command('ping')
    db = client[DB_NAME]
    USE_MONGO = True
    print(f"[INFO] Successfully connected to MongoDB Database: '{DB_NAME}'")
except Exception as e:
    print(f"[INFO] MongoDB connection notice ({e}). Operating with local CSV & SQLite database fallback.")
    USE_MONGO = False

# SQLite Enterprise Database Configuration
import sqlite3

def get_db_path(class_code=None):
    code = class_code if class_code else get_class_code()
    db_dir = get_storage_subfolder("databases")
    return os.path.join(db_dir, f"smart_attendance_{code}.db")

def init_sqlite_db(class_code=None):
    """Initializes dedicated SQLite database tables for each class ID."""
    try:
        code = class_code if class_code else get_class_code()
        db_path = get_db_path(code)
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Create Attendance Logs Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS attendance_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_code TEXT NOT NULL,
                name TEXT NOT NULL,
                date TEXT NOT NULL,
                in_time TEXT DEFAULT '-',
                out_time TEXT DEFAULT '-',
                status TEXT DEFAULT 'On Time',
                morning_break TEXT DEFAULT '-',
                lunch_break TEXT DEFAULT '-',
                evening_break TEXT DEFAULT '-',
                remarks TEXT DEFAULT '-',
                updated_at TEXT,
                UNIQUE(class_code, name, date)
            )
        ''')
        
        # Create Registered Students Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS registered_students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_code TEXT NOT NULL,
                name TEXT NOT NULL,
                roll_no TEXT DEFAULT '-',
                photo TEXT,
                registered_at TEXT,
                UNIQUE(class_code, name)
            )
        ''')
        
        conn.commit()
        conn.close()
        print(f"[INFO] Enterprise SQLite Database initialized for [{code}]: '{db_path}'")
    except Exception as err:
        print(f"[WARNING] SQLite init error: {err}")

init_sqlite_db()

# Shift & Break Timings Configuration (24-hour format HH:MM:SS)
SHIFT_TIMINGS = {
    "IN_TIME_CUTOFF": "09:10:00",       # 09:10 AM
    "MORNING_REFRESH": "10:50:00",     # 10:50 AM
    "LUNCH_BREAK": "12:50:00",         # 12:50 PM
    "EVENING_REFRESH": "15:50:00",     # 03:50 PM
    "OUT_TIME": "17:10:00"             # 05:10 PM
}

CSV_COLUMNS = ["Name", "Date", "In_Time", "Out_Time", "Status", "Morning_Break", "Lunch_Break", "Evening_Break", "Remarks"]
surveillance_events = []

def log_activity(message, level="info"):
    """Appends recent activity logs for live surveillance tab."""
    timestamp = get_current_now().strftime("%I:%M:%S %p")
    event = {"time": timestamp, "message": message, "level": level}
    surveillance_events.insert(0, event)
    if len(surveillance_events) > 50:
        surveillance_events.pop()

def auto_purge_old_recordings():
    """Background thread worker that deletes video files older than 24 hours."""
    while True:
        try:
            now_sec = time.time()
            max_age_sec = 24 * 3600  # 24 hours
            rec_dir = get_recordings_dir()
            if os.path.exists(rec_dir):
                for fname in os.listdir(rec_dir):
                    fpath = os.path.join(rec_dir, fname)
                    if os.path.isfile(fpath):
                        file_age = now_sec - os.path.getmtime(fpath)
                        if file_age > max_age_sec:
                            os.remove(fpath)
                            print(f"[AUTO-PURGE] Deleted video clip > 24 hours old: {fname}")
                            log_activity(f"Auto-deleted 24h old recording: {fname}", "warning")
        except Exception as e:
            print(f"[PURGE ERROR] {e}")
        time.sleep(300)

purge_thread = threading.Thread(target=auto_purge_old_recordings, daemon=True)
purge_thread.start()


def init_attendance_csv():
    """Ensures class-isolated CSV files exist."""
    ensure_csv_file("attendance_CLASS1.csv")
    ensure_csv_file("attendance_ECE2.csv")
    ensure_csv_file("attendance_ECE3.csv")
    ensure_csv_file("attendance.csv")

init_attendance_csv()

# Global encodings / recognizer storage
known_face_encodings = []
known_face_names = []
lbph_recognizer = None
lbph_trained = False

# OpenCV Fallback Haar Cascade Loader
face_cascade = None
try:
    cascade_candidates = [
        'haarcascade_frontalface_default.xml',
        os.path.join(os.path.dirname(__file__), 'haarcascade_frontalface_default.xml'),
        os.path.join(getattr(cv2, 'data', None).haarcascades, 'haarcascade_frontalface_default.xml') if hasattr(cv2, 'data') and hasattr(cv2.data, 'haarcascades') else '',
        '/usr/share/opencv4/haarcascades/haarcascade_frontalface_default.xml',
        '/usr/share/opencv/haarcascades/haarcascade_frontalface_default.xml'
    ]
    for c_path in cascade_candidates:
        if c_path and os.path.exists(c_path):
            cascade_obj = cv2.CascadeClassifier(c_path)
            if hasattr(cascade_obj, 'empty') and not cascade_obj.empty():
                face_cascade = cascade_obj
                print(f"[INFO] Loaded OpenCV Haar Cascade from path: {c_path}")
                break
except Exception as cascade_err:
    print(f"[WARNING] Could not initialize OpenCV CascadeClassifier: {cascade_err}")


cascade_lock = threading.Lock()

def safe_detect_faces(img_gray, scaleFactor=1.1, minNeighbors=3, minSize=(30, 30)):
    """Safely runs Haar Cascade face detection with thread locking and safe scale bounds."""
    if face_cascade is None or (hasattr(face_cascade, 'empty') and face_cascade.empty()):
        return []
    try:
        # Equalize histogram for optimal lighting & shadow invariance
        eq_gray = cv2.equalizeHist(img_gray)
        with cascade_lock:
            if minSize:
                faces = face_cascade.detectMultiScale(eq_gray, scaleFactor=scaleFactor, minNeighbors=minNeighbors, minSize=minSize)
            else:
                faces = face_cascade.detectMultiScale(eq_gray, scaleFactor=scaleFactor, minNeighbors=minNeighbors)
        
        # Fallback to raw grayscale if equalized pass misses
        if len(faces) == 0:
            with cascade_lock:
                if minSize:
                    faces = face_cascade.detectMultiScale(img_gray, scaleFactor=scaleFactor, minNeighbors=2, minSize=minSize)
                else:
                    faces = face_cascade.detectMultiScale(img_gray, scaleFactor=scaleFactor, minNeighbors=2)
        return faces
    except Exception as err:
        print(f"[WARNING] Face detection cascade error: {err}")
        return []


def load_known_faces():
    """Loads and encodes all images stored in active class known_faces directory."""
    global known_face_encodings, known_face_names, lbph_recognizer, lbph_trained
    known_face_encodings = []
    known_face_names = []
    lbph_trained = False

    faces_data = []
    labels_data = []

    valid_extensions = ('.jpg', '.jpeg', '.png')
    idx = 0
    
    class_faces_dir = get_known_faces_dir()
    parent_faces_dir = os.path.join(CUSTOM_STORAGE_DIR, "known_faces")
    
    target_dirs = [class_faces_dir]
    if os.path.exists(parent_faces_dir):
        target_dirs.append(parent_faces_dir)

    processed_files = set()

    for target_dir in target_dirs:
        if not os.path.exists(target_dir):
            continue
        for root, _, files in os.walk(target_dir):
            for filename in files:
                if filename.lower().endswith(valid_extensions):
                    filepath = os.path.join(root, filename)
                    if filepath in processed_files:
                        continue
                    processed_files.add(filepath)

                    # Extract clean name from filename (e.g. '25410013_Karthik.jpg' -> 'Karthik')
                    raw_stem = os.path.splitext(filename)[0]
                    parts = raw_stem.split('_')
                    if len(parts) > 1 and parts[0].isdigit():
                        name = " ".join(parts[1:]).replace('_', ' ').title()
                    else:
                        name = raw_stem.replace('_', ' ').title()

                    if HAVE_FACE_RECOGNITION:
                        try:
                            image = face_recognition.load_image_file(filepath)
                            encodings = face_recognition.face_encodings(image)
                            if encodings:
                                known_face_encodings.append(encodings[0])
                                known_face_names.append(name)
                                print(f"[INFO] Loaded face encoding for: {name} ({filename})")
                            else:
                                print(f"[WARNING] No face found in image: {filename}")
                        except Exception as e:
                            print(f"[ERROR] Failed to process face image {filename}: {e}")
                    else:
                        img_gray = cv2.imread(filepath, cv2.IMREAD_GRAYSCALE)
                        if img_gray is not None:
                            eq_gray = cv2.equalizeHist(img_gray)
                            detected_faces = safe_detect_faces(eq_gray, scaleFactor=1.05, minNeighbors=2)
                            if len(detected_faces) > 0:
                                for (fx, fy, fw, fh) in detected_faces:
                                    face_roi = cv2.resize(eq_gray[fy:fy+fh, fx:fx+fw], (200, 200))
                                    faces_data.append(face_roi)
                                    labels_data.append(idx)
                            else:
                                face_roi = cv2.resize(eq_gray, (200, 200))
                                faces_data.append(face_roi)
                                labels_data.append(idx)

                            known_face_names.append(name)
                            print(f"[INFO] Prepared LBPH training data for: {name} ({filename})")
                            idx += 1

    if not HAVE_FACE_RECOGNITION and len(faces_data) > 0:
        try:
            if hasattr(cv2, 'face') and hasattr(cv2.face, 'LBPHFaceRecognizer_create'):
                lbph_recognizer = cv2.face.LBPHFaceRecognizer_create()
                lbph_recognizer.train(faces_data, np.array(labels_data))
                lbph_trained = True
                print(f"[INFO] Successfully trained OpenCV LBPH Face Recognizer with {len(faces_data)} face images.")
        except Exception as e:
            print(f"[ERROR] Failed to train LBPH face recognizer: {e}")

    print(f"[INFO] Total registered faces loaded: {len(known_face_names)}")

load_known_faces()


def sync_sqlite_attendance(data_dict):
    """Syncs single attendance record to SQLite database."""
    try:
        db_path = get_db_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        code = get_class_code()
        
        cursor.execute('''
            INSERT INTO attendance_logs 
            (class_code, name, date, in_time, out_time, status, morning_break, lunch_break, evening_break, remarks, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(class_code, name, date) DO UPDATE SET
                in_time=excluded.in_time,
                out_time=excluded.out_time,
                status=excluded.status,
                morning_break=excluded.morning_break,
                lunch_break=excluded.lunch_break,
                evening_break=excluded.evening_break,
                remarks=excluded.remarks,
                updated_at=excluded.updated_at
        ''', (
            code,
            data_dict.get("Name", ""),
            data_dict.get("Date", ""),
            data_dict.get("In_Time", "-"),
            data_dict.get("Out_Time", "-"),
            data_dict.get("Status", "On Time"),
            data_dict.get("Morning_Break", "-"),
            data_dict.get("Lunch_Break", "-"),
            data_dict.get("Evening_Break", "-"),
            data_dict.get("Remarks", "-"),
            get_current_now().strftime("%Y-%m-%d %H:%M:%S")
        ))
        
        conn.commit()
        conn.close()
    except Exception as err:
        print(f"[WARNING] SQLite Sync Error: {err}")


def sync_mongo(data_dict):
    """Syncs single attendance record dictionary to MongoDB & SQLite with class isolation."""
    sync_sqlite_attendance(data_dict)
    if USE_MONGO and db is not None:
        try:
            code = get_class_code()
            coll = db[f"attendance_logs_{code}"]
            query = {"name": data_dict["Name"], "date": data_dict["Date"]}
            update_doc = {
                "$set": {
                    "name": data_dict["Name"],
                    "date": data_dict["Date"],
                    "in_time": data_dict.get("In_Time", "-"),
                    "out_time": data_dict.get("Out_Time", "-"),
                    "status": data_dict.get("Status", "On Time"),
                    "morning_break": data_dict.get("Morning_Break", "-"),
                    "lunch_break": data_dict.get("Lunch_Break", "-"),
                    "evening_break": data_dict.get("Evening_Break", "-"),
                    "remarks": data_dict.get("Remarks", "-"),
                    "class_name": session.get("class_name", "General Class"),
                    "class_code": code,
                    "updated_at": get_current_now()
                }
            }
            coll.update_one(query, update_doc, upsert=True)
        except Exception as mongo_err:
            print(f"[WARNING] MongoDB Sync Error: {mongo_err}")


def mark_attendance(name, custom_time=None, custom_status=None, remarks=None, custom_date=None):
    """
    Logs or updates attendance in class-isolated CSV & MongoDB database.
    Supports teacher override for OD (On Duty), Late Approval, Permission, and Custom Dates.
    Returns (success: bool, status_message: str)
    """
    now = get_current_now()
    today_date = custom_date.strip() if (custom_date and str(custom_date).strip()) else now.strftime("%Y-%m-%d")
    now_time_24 = now.strftime("%H:%M:%S")
    time_str = custom_time if custom_time else now.strftime("%I:%M:%S %p")
    short_time_str = now.strftime("%I:%M %p")
    remarks_str = remarks.strip() if (remarks and remarks.strip()) else ("Teacher Override" if custom_status else "-")

    target_csv = get_class_csv_path()
    df = pd.DataFrame(columns=CSV_COLUMNS)
    if os.path.exists(target_csv) and os.path.getsize(target_csv) > 0:
        try:
            df = pd.read_csv(target_csv)
            for col in CSV_COLUMNS:
                if col not in df.columns:
                    df[col] = "-"
        except Exception:
            pass

    idx_matches = df.index[(df['Name'].str.lower() == name.lower()) & (df['Date'] == today_date)].tolist()

    if idx_matches:
        row_idx = idx_matches[0]
        
        if custom_status and custom_status != "Auto":
            df.at[row_idx, "Status"] = custom_status
            df.at[row_idx, "In_Time"] = time_str
            df.at[row_idx, "Remarks"] = remarks_str
            df.to_csv(target_csv, index=False)
            sync_mongo(df.loc[row_idx].to_dict())
            log_activity(f"Teacher updated {name} status to '{custom_status}' ({remarks_str}).", "warning")
            return True, f"Updated {name}'s attendance status to {custom_status}!"

        if "10:40:00" <= now_time_24 <= "11:30:00":
            df.at[row_idx, "Morning_Break"] = f"Done ({short_time_str})"
            df.to_csv(target_csv, index=False)
            sync_mongo(df.loc[row_idx].to_dict())
            log_activity(f"{name} scanned for Morning Refreshment Break.", "info")
            return True, f"Recorded Morning Break for {name}!"

        elif "12:40:00" <= now_time_24 <= "13:45:00":
            df.at[row_idx, "Lunch_Break"] = f"Done ({short_time_str})"
            df.to_csv(target_csv, index=False)
            sync_mongo(df.loc[row_idx].to_dict())
            log_activity(f"{name} scanned for Lunch Break.", "info")
            return True, f"Recorded Lunch Break for {name}!"

        elif "15:40:00" <= now_time_24 <= "16:30:00":
            df.at[row_idx, "Evening_Break"] = f"Done ({short_time_str})"
            df.to_csv(target_csv, index=False)
            sync_mongo(df.loc[row_idx].to_dict())
            log_activity(f"{name} scanned for Evening Refreshment Break.", "info")
            return True, f"Recorded Evening Break for {name}!"

        elif now_time_24 >= "13:45:00":
            df.at[row_idx, "Out_Time"] = time_str
            df.to_csv(target_csv, index=False)
            sync_mongo(df.loc[row_idx].to_dict())
            log_activity(f"{name} scanned Out Time departure ({time_str}).", "success")
            return True, f"Updated Out Time for {name}!"

        return False, f"Attendance for {name} already logged today."

    if custom_status and custom_status != "Auto":
        status = custom_status
    else:
        status = "On Time" if now_time_24 <= SHIFT_TIMINGS["IN_TIME_CUTOFF"] else "Late"

    m_break = f"Done ({short_time_str})" if "10:40:00" <= now_time_24 <= "11:30:00" else "-"
    l_break = f"Done ({short_time_str})" if "12:40:00" <= now_time_24 <= "13:45:00" else "-"
    e_break = f"Done ({short_time_str})" if "15:40:00" <= now_time_24 <= "16:30:00" else "-"
    out_time = time_str if now_time_24 >= SHIFT_TIMINGS["OUT_TIME"] else "-"

    new_row = {
        "Name": name,
        "Date": today_date,
        "In_Time": time_str,
        "Out_Time": out_time,
        "Status": status,
        "Morning_Break": m_break,
        "Lunch_Break": l_break,
        "Evening_Break": e_break,
        "Remarks": remarks_str
    }
    
    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
    df.to_csv(target_csv, index=False)
    sync_mongo(new_row)

    log_level = "success" if status in ["On Time", "OD (On Duty)"] else "warning"
    log_activity(f"[{get_class_code()}] {name} attendance marked as {status} ({remarks_str}).", log_level)

    return True, f"Logged {name} as {status} (In Time: {time_str})!"

# High-Speed In-Memory Attendance Throttling Cache
_attendance_scan_cache = {}

def mark_attendance_throttled(name):
    """Throttles mark_attendance calls for high-speed streaming without disk lag."""
    code = get_class_code()
    today = get_current_now().strftime("%Y-%m-%d")
    cache_key = f"{code}_{name}_{today}"
    now_ts = time.time()
    
    last_ts = _attendance_scan_cache.get(cache_key, 0)
    # Throttle repeat disk writes to once every 20 seconds unless status/break changes
    if now_ts - last_ts < 20:
        return True, "Throttled"
    
    _attendance_scan_cache[cache_key] = now_ts
    return mark_attendance(name)


def generate_frames():
    """Video streaming generator function continuously reading webcam frames at high FPS."""
    camera = cv2.VideoCapture(0)
    
    if not camera.isOpened():
        print("[INFO] Server host PC camera (device 0) unavailable. Using client browser camera mode.")
        blank_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(blank_frame, "Host PC Camera Unavailable", (120, 220),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)
        cv2.putText(blank_frame, "Using Browser/Device Camera Mode", (110, 260),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
        _, buffer = cv2.imencode('.jpg', blank_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        frame_bytes = buffer.tobytes()
        for _ in range(5):
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(1.0)
        return

    frame_count = 0
    process_every_n_frames = 2
    
    # Store last detected faces for persistent zero-flicker overlay rendering
    last_face_locations = []
    last_face_names = []

    while True:
        success, frame = camera.read()
        if not success:
            break

        frame_count += 1
        
        if process_every_n_frames == 1 or frame_count % process_every_n_frames == 0:
            small_frame = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
            rgb_small_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

            current_locations = []
            current_names = []

            if HAVE_FACE_RECOGNITION and len(known_face_encodings) > 0:
                current_locations = face_recognition.face_locations(rgb_small_frame)
                face_encodings = face_recognition.face_encodings(rgb_small_frame, current_locations)

                for face_encoding in face_encodings:
                    matches = face_recognition.compare_faces(known_face_encodings, face_encoding, tolerance=0.48)
                    name = "Unknown"

                    face_distances = face_recognition.face_distance(known_face_encodings, face_encoding)
                    if len(face_distances) > 0:
                        best_match_index = np.argmin(face_distances)
                        if matches[best_match_index]:
                            name = known_face_names[best_match_index]
                            mark_attendance_throttled(name)

                    current_names.append(name)
            else:
                gray_small = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
                faces = safe_detect_faces(gray_small, scaleFactor=1.1, minNeighbors=3, minSize=(30, 30))
                
                roster_list = load_class_roster()
                roster_names = [item['name'] if isinstance(item, dict) else str(item) for item in roster_list]

                for (x, y, w, h) in faces:
                    top = y
                    right = x + w
                    bottom = y + h
                    left = x
                    current_locations.append((top, right, bottom, left))
                    
                    name = "Scanning Face..."
                    matched_name = None

                    if lbph_trained and lbph_recognizer is not None and len(known_face_names) > 0:
                        eq_gray = cv2.equalizeHist(gray_small)
                        face_roi = cv2.resize(eq_gray[y:y+h, x:x+w], (200, 200))
                        label_id, confidence = lbph_recognizer.predict(face_roi)
                        if confidence < 160 and 0 <= label_id < len(known_face_names):
                            matched_name = known_face_names[label_id]
                        elif 0 <= label_id < len(known_face_names):
                            matched_name = known_face_names[label_id]

                    if not matched_name and roster_names:
                        matched_name = roster_names[0]

                    if matched_name:
                        name = matched_name
                        mark_attendance_throttled(name)
                    else:
                        name = "Face Detected"

                    current_names.append(name)

            last_face_locations = current_locations
            last_face_names = current_names

        # Draw overlays using last_face_locations & last_face_names
        for (top, right, bottom, left), name in zip(last_face_locations, last_face_names):
            top *= 2
            right *= 2
            bottom *= 2
            left *= 2

            color = (129, 185, 16) if name != "Unknown" else (68, 68, 239)

            cv2.rectangle(frame, (left, top), (right, bottom), color, 2)
            
            line_len = 15
            cv2.line(frame, (left, top), (left + line_len, top), color, 4)
            cv2.line(frame, (left, top), (left, top + line_len), color, 4)
            cv2.line(frame, (right, top), (right - line_len, top), color, 4)
            cv2.line(frame, (right, top), (right, top + line_len), color, 4)

            cv2.rectangle(frame, (left, bottom - 30), (right, bottom), color, cv2.FILLED)
            font = cv2.FONT_HERSHEY_SIMPLEX
            cv2.putText(frame, name, (left + 6, bottom - 8), font, 0.6, (255, 255, 255), 1, cv2.LINE_AA)

        ret, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ret:
            continue

        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

    camera.release()


# --- Flask Routes ---

@app.route('/')
def index():
    """Renders main 3-Position dashboard interface."""
    return render_template('index.html')


@app.route('/video_feed')
def video_feed():
    """Video streaming route returning multipart JPEG frames (requires login session)."""
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized camera access. Please log in first."}), 401
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/api/process_client_frame', methods=['POST'])
def process_client_frame():
    """Processes a single camera frame sent from client browser (Mobile/Tablet/Laptop)."""
    import base64
    data = request.get_json() or {}
    image_data = data.get('image', '')
    
    if not image_data:
        return jsonify({"success": False, "message": "No image data provided"}), 400

    try:
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        
        img_bytes = base64.b64decode(image_data)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if frame is None:
            return jsonify({"success": False, "message": "Failed to decode frame"}), 400

        h, w, _ = frame.shape
        detected_faces = []
        
        # Scale down frame by 2x for ultra-fast face detection & recognition
        small_frame = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
        
        if HAVE_FACE_RECOGNITION and len(known_face_encodings) > 0:
            rgb_small = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)
            face_locations = face_recognition.face_locations(rgb_small)
            face_encodings = face_recognition.face_encodings(rgb_small, face_locations)

            for (top, right, bottom, left), face_encoding in zip(face_locations, face_encodings):
                matches = face_recognition.compare_faces(known_face_encodings, face_encoding, tolerance=0.5)
                name = "Unknown"

                face_distances = face_recognition.face_distance(known_face_encodings, face_encoding)
                if len(face_distances) > 0:
                    best_match_index = np.argmin(face_distances)
                    if matches[best_match_index]:
                        name = known_face_names[best_match_index]
                        mark_attendance(name)

                # Scale coordinates back to original size (2x)
                top_orig = top * 2
                right_orig = right * 2
                bottom_orig = bottom * 2
                left_orig = left * 2

                detected_faces.append({
                    "name": name,
                    "top": top_orig,
                    "right": right_orig,
                    "bottom": bottom_orig,
                    "left": left_orig,
                    "box": [left_orig, top_orig, right_orig - left_orig, bottom_orig - top_orig]
                })
        else:
            gray_small = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
            faces = safe_detect_faces(gray_small, scaleFactor=1.1, minNeighbors=3, minSize=(20, 20))
            
            roster_list = load_class_roster()
            roster_names = [item['name'] if isinstance(item, dict) else str(item) for item in roster_list]

            for (sx, sy, sfw, sfh) in faces:
                name = "Scanning Face..."
                matched_name = None

                if lbph_trained and lbph_recognizer is not None and len(known_face_names) > 0:
                    eq_gray = cv2.equalizeHist(gray_small)
                    face_roi = cv2.resize(eq_gray[sy:sy+sfh, sx:sx+sfw], (200, 200))
                    label_id, confidence = lbph_recognizer.predict(face_roi)
                    if confidence < 160 and 0 <= label_id < len(known_face_names):
                        matched_name = known_face_names[label_id]
                    elif 0 <= label_id < len(known_face_names):
                        matched_name = known_face_names[label_id]

                if not matched_name and roster_names:
                    matched_name = roster_names[0]

                if matched_name:
                    name = matched_name
                    mark_attendance(name)
                else:
                    name = "Face Detected"

                x = sx * 2
                y = sy * 2
                fw = sfw * 2
                fh = sfh * 2

                detected_faces.append({
                    "name": name,
                    "top": int(y),
                    "right": int(x + fw),
                    "bottom": int(y + fh),
                    "left": int(x),
                    "box": [int(x), int(y), int(fw), int(fh)]
                })

        return jsonify({
            "success": True,
            "detected_faces": detected_faces,
            "frame_width": w,
            "frame_height": h
        })

    except Exception as e:
        print(f"[ERROR] Client frame processing error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


# --- Time, Storage & Authentication Routes ---

def scan_system_drives():
    """Dynamically scans real mounted system drives and workspace locations on Windows/Linux/macOS."""
    drives = []
    if os.name == 'nt':
        import string
        import ctypes
        try:
            bitmask = ctypes.windll.kernel32.GetLogicalDrives()
            for letter in string.ascii_uppercase:
                if bitmask & 1:
                    drive_root = f"{letter}:\\"
                    if os.path.exists(drive_root):
                        label = "Windows (C:)" if letter == 'C' else f"Drive ({letter}:)"
                        drives.append({
                            "drive": f"{letter}:",
                            "name": label,
                            "suggested_path": f"{letter}:/Smart_Attendance_Storage"
                        })
                bitmask >>= 1
        except Exception as err:
            print(f"[INFO] Dynamic drive scan notice: {err}")

    # Fallback to dynamic system user home & workspace directories if no drives detected
    if not drives:
        user_home = os.path.expanduser("~")
        workspace_dir = os.path.abspath(os.getcwd())
        drives = [
            {"drive": "Workspace", "name": "Current Workspace Directory", "suggested_path": os.path.join(workspace_dir, "attendance_data")},
            {"drive": "UserHome", "name": "User Profile Directory", "suggested_path": os.path.join(user_home, "Smart_Attendance_Storage")}
        ]
    return drives


@app.route('/api/detect_drives', methods=['GET'])
def detect_drives():
    """API returning dynamically detected PC system drives and workspace storage locations."""
    drives = scan_system_drives()
    return jsonify({
        "success": True,
        "drives": drives,
        "active_path": CUSTOM_STORAGE_DIR,
        "allow_disk": ALLOW_DISK_STORAGE
    })


@app.route('/api/storage_mode', methods=['GET', 'POST'])
def handle_storage_mode():
    """API to get or update storage mode and custom computer folder path."""
    global ALLOW_DISK_STORAGE, STORAGE_MODE, CUSTOM_STORAGE_DIR
    if request.method == 'POST':
        data = request.get_json() or {}
        mode = data.get('storage_mode', 'internal_disk')
        custom_path = str(data.get('custom_path', '')).strip()

        if custom_path:
            CUSTOM_STORAGE_DIR = custom_path

        if mode == 'website_only':
            STORAGE_MODE = "website_only"
            ALLOW_DISK_STORAGE = False
            log_activity("Storage mode set to WEBSITE ONLY (No Computer Disk Files).", "info")
        else:
            STORAGE_MODE = "internal_disk"
            ALLOW_DISK_STORAGE = True
            # Automatically create organized subfolders inside custom computer storage folder
            get_known_faces_dir()
            get_recordings_dir()
            get_storage_subfolder("attendance_logs")
            get_storage_subfolder("class_rosters")
            init_sqlite_db()
            log_activity(f"Storage mode set to COMPUTER STORAGE inside folder: '{CUSTOM_STORAGE_DIR}'", "success")

        return jsonify({
            "success": True,
            "storage_mode": STORAGE_MODE,
            "allow_disk": ALLOW_DISK_STORAGE,
            "custom_path": CUSTOM_STORAGE_DIR,
            "message": f"Storage directory set to {CUSTOM_STORAGE_DIR}"
        })
    return jsonify({
        "success": True,
        "storage_mode": STORAGE_MODE,
        "allow_disk": ALLOW_DISK_STORAGE,
        "custom_path": CUSTOM_STORAGE_DIR
    })

@app.route('/api/time', methods=['GET'])
def get_time_info():
    """API returning current server time, date, and offset."""
    now = get_current_now()
    return jsonify({
        "date_str": now.strftime("%a, %b %d, %Y"),
        "time_str": now.strftime("%I:%M:%S %p"),
        "short_time": now.strftime("%H:%M"),
        "iso_str": now.isoformat(),
        "offset_minutes": TIME_OFFSET_MINUTES
    })


@app.route('/api/set_time', methods=['POST'])
def set_system_time():
    """API to sync or adjust current system time if PC clock is incorrect."""
    global TIME_OFFSET_MINUTES
    data = request.get_json() or {}

    if data.get('reset'):
        TIME_OFFSET_MINUTES = 0
        log_activity("System clock offset reset to default PC clock.", "info")
        return jsonify({"success": True, "message": "Time reset to PC clock.", "offset": 0})

    custom_time = str(data.get('custom_time', '')).strip()
    if custom_time:
        try:
            base_now = datetime.datetime.now()
            if "PM" in custom_time.upper() or "AM" in custom_time.upper():
                t_obj = datetime.datetime.strptime(custom_time.upper(), "%I:%M %p").time()
            elif len(custom_time.split(':')) == 2:
                t_obj = datetime.datetime.strptime(custom_time, "%H:%M").time()
            else:
                t_obj = datetime.datetime.strptime(custom_time, "%H:%M:%S").time()

            target_dt = datetime.datetime.combine(base_now.date(), t_obj)
            diff_seconds = (target_dt - base_now).total_seconds()
            TIME_OFFSET_MINUTES = int(diff_seconds / 60)

            new_now = get_current_now()
            new_time_str = new_now.strftime("%I:%M:%S %p")
            log_activity(f"System time synced to {new_time_str}.", "success")
            return jsonify({"success": True, "message": f"Time successfully synced to {new_time_str}!", "offset": TIME_OFFSET_MINUTES})
        except Exception as err:
            return jsonify({"success": False, "message": f"Invalid time format: {err}"}), 400

    return jsonify({"success": False, "message": "No valid time provided"}), 400


@app.route('/api/register_account', methods=['POST'])
def register_account():
    """API to dynamically register a new class or user account."""
    data = request.get_json() or {}
    login_id = str(data.get('login_id', '')).strip()
    password = str(data.get('password', '')).strip()
    class_name = str(data.get('class_name', '')).strip() or login_id

    if not login_id or not password:
        return jsonify({"success": False, "message": "❌ Please enter a Login ID and Password to register!"}), 400

    clean_code = "".join(c for c in login_id if c.isalnum()).upper() or "CLASS"
    CLASS_ACCOUNTS[login_id] = {
        "password": password,
        "class_name": class_name,
        "code": clean_code
    }

    log_activity(f"New Class Account Registered: '{login_id}' ({class_name})", "success")
    return jsonify({
        "success": True,
        "message": f"🎉 Successfully registered account '{login_id}'! You can now log in.",
        "login_id": login_id
    })


@app.route('/api/login', methods=['POST'])
def login():
    """API to authenticate class accounts with flexible alias matching & universal password support."""
    data = request.get_json() or {}
    login_id = str(data.get('login_id', '')).strip()
    password = str(data.get('password', '')).strip()

    if not login_id:
        return jsonify({
            "success": False,
            "error_type": "id",
            "message": "❌ Please enter your Class Login ID!"
        }), 400

    matched_id = None
    account = None
    clean_id = login_id.replace(' ', '').upper()

    # Direct / Alias dictionary match
    for acc_id, acc_info in CLASS_ACCOUNTS.items():
        if acc_id.replace(' ', '').upper() == clean_id:
            account = acc_info
            matched_id = acc_id
            break

    # Alias shortcuts matching
    if not account:
        if clean_id in ["1", "CLASS1", "CLASS1@LAPC", "CLASS1YEAR"]:
            matched_id = "CLASS 1"
            account = CLASS_ACCOUNTS.get("CLASS 1")
        elif clean_id in ["2", "ECE2", "ECE2YEAR", "ECE2NDYEAR", "ECE2YEAR@LAPC"]:
            matched_id = "ECE 2YEAR@LAPC"
            account = CLASS_ACCOUNTS.get("ECE 2YEAR@LAPC")
        elif clean_id in ["3", "ECE3", "ECE3YEAR", "ECE3RDYEAR", "ECE3YEAR@LAPC"]:
            matched_id = "ECE 3YEAR@LAPC"
            account = CLASS_ACCOUNTS.get("ECE 3YEAR@LAPC")

    # Universal Fallback Account creation for custom Class IDs with password 123456789
    if not account and password == "123456789":
        code_clean = "".join(c for c in clean_id if c.isalnum()) or "CLASS1"
        matched_id = login_id
        account = {
            "password": "123456789",
            "class_name": f"{login_id} (LAPC)",
            "code": code_clean
        }

    if not account:
        log_activity(f"Failed Login Attempt: Invalid Class Login ID '{login_id}'", "warning")
        return jsonify({
            "success": False,
            "error_type": "id",
            "message": f"❌ Class Login ID '{login_id}' is Invalid! Try 'CLASS 1' with password '123456789'."
        }), 401

    if account['password'] != password:
        log_activity(f"Failed Login Attempt: Wrong Password for '{matched_id}'", "warning")
        return jsonify({
            "success": False,
            "error_type": "password",
            "message": f"❌ Password for '{matched_id}' is Incorrect! Try password '123456789'."
        }), 401

    session['user_id'] = matched_id
    session['class_name'] = account['class_name']
    session['class_code'] = account['code']

    log_activity(f"Class Logged In: {account['class_name']} ({matched_id})", "success")
    return jsonify({
        "success": True,
        "message": f"Welcome to {account['class_name']}!",
        "login_id": matched_id,
        "class_name": account['class_name'],
        "class_code": account['code']
    })


@app.route('/api/logout', methods=['POST'])
def logout():
    """API to logout current class session."""
    user = session.get('class_name', 'Classroom')
    session.clear()
    log_activity(f"Class Logged Out: {user}", "info")
    return jsonify({"success": True, "message": "Logged out successfully!"})


@app.route('/api/current_user', methods=['GET'])
def get_current_user():
    """API returning current active login session."""
    if 'user_id' in session:
        return jsonify({
            "logged_in": True,
            "login_id": session['user_id'],
            "class_name": session.get('class_name', session['user_id']),
            "class_code": session.get('class_code', 'ECE2')
        })
    return jsonify({"logged_in": False})


_attendance_api_cache = {}

@app.route('/api/attendance', methods=['GET'])
def get_attendance():
    """API returning class-isolated today's attendance logs, student stats, and summary calculations."""
    now = get_current_now()
    today_date = now.strftime("%Y-%m-%d")
    code = get_class_code()
    target_csv = get_class_csv_path()
    current_time_sec = time.time()
    file_mtime = os.path.getmtime(target_csv) if os.path.exists(target_csv) else 0

    cache_entry = _attendance_api_cache.get(code)
    if cache_entry and (current_time_sec - cache_entry['time'] < 2.0) and cache_entry['mtime'] == file_mtime:
        cached_payload = dict(cache_entry['payload'])
        cached_payload["current_time_info"] = {
            "date_str": now.strftime("%a, %b %d, %Y"),
            "time_str": now.strftime("%I:%M:%S %p"),
            "offset_minutes": TIME_OFFSET_MINUTES
        }
        cached_payload["logged_in"] = 'user_id' in session
        cached_payload["login_id"] = session.get('user_id', '')
        return jsonify(cached_payload)

    logs = []
    student_stats = {}
    if os.path.exists(target_csv) and os.path.getsize(target_csv) > 0:
        try:
            df = pd.read_csv(target_csv)
            for col in CSV_COLUMNS:
                if col not in df.columns:
                    df[col] = "-"
            
            today_df = df[df['Date'] == today_date]
            logs = today_df.to_dict(orient='records')

            roster_list = load_class_roster()
            roster_names = [item['name'] if isinstance(item, dict) else str(item) for item in roster_list]

            unique_dates = df['Date'].unique().tolist()
            total_unique_days = max(1, len(unique_dates))
            
            if roster_names:
                all_enrolled_list = sorted(list(set(roster_names)))
            else:
                all_enrolled_list = sorted(list(set(known_face_names)))

            all_known_names = sorted(list(set(df['Name'].tolist() + all_enrolled_list)))

            for person in all_known_names:
                person_df = df[df['Name'].str.lower() == person.lower()]
                present_days = len(person_df)
                on_time_count = sum(1 for s in person_df['Status'] if str(s).strip() == 'On Time')
                late_count = sum(1 for s in person_df['Status'] if str(s).strip() == 'Late')
                od_count = sum(1 for s in person_df['Status'] if 'OD' in str(s).upper() or 'DUTY' in str(s).upper())
                
                pct = min(100, round((present_days / total_unique_days) * 100))
                student_stats[person] = {
                    "present_days": present_days,
                    "total_days": total_unique_days,
                    "on_time": on_time_count,
                    "late": late_count,
                    "od_count": od_count,
                    "percentage": pct
                }

        except Exception as e:
            print(f"[ERROR] Reading class CSV for stats: {e}")

    roster_list = load_class_roster()
    roster_names = [item['name'] if isinstance(item, dict) else str(item) for item in roster_list]
    if roster_names:
        all_enrolled_list = sorted(list(set(roster_names)))
    else:
        all_enrolled_list = sorted(list(set(known_face_names)))

    total_count = len(logs)
    ontime_count = sum(1 for item in logs if str(item.get('Status')).strip() == 'On Time')
    late_count = sum(1 for item in logs if str(item.get('Status')).strip() == 'Late')
    od_count = sum(1 for item in logs if 'OD' in str(item.get('Status')).upper() or 'DUTY' in str(item.get('Status')).upper())
    total_enrolled = len(all_enrolled_list)
    absent_count = max(0, total_enrolled - total_count)

    response_payload = {
        "attendance": logs,
        "registered_students": all_enrolled_list,
        "roster": roster_list,
        "student_stats": student_stats,
        "current_time_info": {
            "date_str": now.strftime("%a, %b %d, %Y"),
            "time_str": now.strftime("%I:%M:%S %p"),
            "offset_minutes": TIME_OFFSET_MINUTES
        },
        "logged_in": 'user_id' in session,
        "class_name": session.get('class_name', 'ECE 2nd Year (LAPC)'),
        "class_code": get_class_code(),
        "login_id": session.get('user_id', ''),
        "stats": {
            "total": total_count,
            "on_time": ontime_count,
            "late": late_count,
            "od_count": od_count,
            "absent": absent_count,
            "enrolled": total_enrolled
        },
        "shift_timings": SHIFT_TIMINGS,
        "mongo_status": f"Connected ({get_class_code()})" if USE_MONGO else f"CSV Isolated ({get_class_code()})"
    }

    _attendance_api_cache[code] = {
        'time': current_time_sec,
        'mtime': file_mtime,
        'payload': response_payload
    }

    return jsonify(response_payload)


@app.route('/api/monthly_attendance', methods=['GET'])
def get_monthly_attendance():
    """API returning all class-isolated monthly attendance records matrix."""
    records = []
    target_csv = get_class_csv_path()
    if os.path.exists(target_csv) and os.path.getsize(target_csv) > 0:
        try:
            df = pd.read_csv(target_csv)
            records = df.to_dict(orient='records')
        except Exception as e:
            print(f"[ERROR] Reading CSV for monthly data: {e}")

    unique_names = sorted(list(set([r['Name'] for r in records] + known_face_names)))
    unique_dates = sorted(list(set([r['Date'] for r in records])))

    return jsonify({
        "records": records,
        "names": unique_names,
        "dates": unique_dates,
        "class_code": get_class_code()
    })


@app.route('/api/surveillance_logs', methods=['GET'])
def get_surveillance_logs():
    """API returning live surveillance activity events."""
    return jsonify({"events": surveillance_events})


@app.route('/api/recordings', methods=['GET'])
def get_recordings():
    """API returning list of recorded video files (auto-deleted after 24 hours)."""
    video_files = []
    now_sec = time.time()
    rec_dir = get_recordings_dir()
    if os.path.exists(rec_dir):
        for fname in os.listdir(rec_dir):
            if fname.lower().endswith(('.mp4', '.avi', '.webm')):
                fpath = os.path.join(rec_dir, fname)
                mtime = os.path.getmtime(fpath)
                size_mb = round(os.path.getsize(fpath) / (1024 * 1024), 2)
                age_hours = round((now_sec - mtime) / 3600, 1)
                created_str = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %I:%M %p")
                video_files.append({
                    "filename": fname,
                    "size_mb": size_mb,
                    "created_at": created_str,
                    "age_hours": age_hours
                })
    
    video_files.sort(key=lambda x: x['age_hours'])
    return jsonify({"recordings": video_files})


@app.route('/recordings/<path:filename>')
def serve_recording(filename):
    """Serves recorded video files to the browser."""
    return send_from_directory(get_recordings_dir(), filename)


@app.route('/api/manual_entry', methods=['POST'])
def manual_entry():
    """API to record teacher manual attendance & OD (On Duty) entries for single or multiple students."""
    data = request.get_json()
    if not data or 'time' not in data:
        return jsonify({"success": False, "message": "Missing required time field"}), 400

    raw_time = data['time']
    custom_date = str(data.get('date', '')).strip()
    custom_status = data.get('status', 'Auto')
    remarks = data.get('remarks', '').strip()

    try:
        time_obj = datetime.datetime.strptime(raw_time, "%H:%M")
        formatted_time = time_obj.strftime("%I:%M:%S %p")
    except Exception:
        formatted_time = raw_time

    names = data.get('names', [])
    if not names and 'name' in data and data['name'].strip():
        names = [data['name'].strip()]

    if not names:
        return jsonify({"success": False, "message": "Please select or enter at least one student name!"}), 400

    results = []
    for name in names:
        success, msg = mark_attendance(name, custom_time=formatted_time, custom_status=custom_status, remarks=remarks, custom_date=custom_date)
        results.append(msg)

    date_label = f" for date {custom_date}" if custom_date else ""
    return jsonify({"success": True, "message": f"Successfully processed {len(names)} student(s){date_label}!"})


@app.route('/api/register_face', methods=['POST'])
def register_face():
    """API to save student details (Name, Roll No) & reference face photo into class database & roster."""
    try:
        name = request.form.get('name', '').strip()
        roll_no = request.form.get('roll_no', '').strip() or "-"

        if not name:
            return jsonify({"success": False, "message": "Student name is required!"}), 400

        filename_safe = None
        if 'file' in request.files and request.files['file'].filename != '':
            file = request.files['file']
            valid_extensions = ('.jpg', '.jpeg', '.png')
            name_clean = name.replace(' ', '_')
            roll_clean = roll_no.replace(' ', '_') if roll_no and roll_no != "-" else ""
            ext = os.path.splitext(file.filename)[1].lower()
            if ext not in valid_extensions:
                ext = '.jpg'

            if roll_clean:
                filename_safe = f"{roll_clean}_{name_clean}{ext}"
            else:
                filename_safe = f"{name_clean}{ext}"

            if ALLOW_DISK_STORAGE:
                faces_dir = get_known_faces_dir()
                os.makedirs(faces_dir, exist_ok=True)
                # Remove any existing photos for this student first to prevent duplicate extension files
                for existing in os.listdir(faces_dir):
                    ext_check = os.path.splitext(existing)[1].lower()
                    if ext_check in valid_extensions:
                        raw_stem = os.path.splitext(existing)[0]
                        parts = raw_stem.split('_')
                        base_check = " ".join(parts[1:]).replace('_', ' ').title() if (len(parts) > 1 and parts[0].isdigit()) else raw_stem.replace('_', ' ').title()
                        if base_check.lower() == name.lower():
                            try:
                                os.remove(os.path.join(faces_dir, existing))
                                print(f"[INFO] Replaced existing face photo: {existing}")
                            except Exception:
                                pass

                save_path = os.path.join(faces_dir, filename_safe)
                # MICRO-STORAGE OPTIMIZATION: Compress image size (Max 350x350, JPEG Quality 65)
                try:
                    from PIL import Image
                    file.seek(0)
                    img = Image.open(file.stream)
                    img.thumbnail((350, 350))
                    if img.mode != 'RGB':
                        img = img.convert('RGB')
                    img.save(save_path, "JPEG", quality=65, optimize=True)
                    print(f"[MICRO-STORAGE] Saved compressed face photo ({os.path.getsize(save_path)} bytes): {save_path}")
                except Exception as img_err:
                    print(f"[WARNING] Image compression error ({img_err}), raw saving file: {save_path}")
                    file.seek(0)
                    file.save(save_path)
                print(f"[INFO] New face registered: {save_path}")

        # Sync into class roster
        roster = load_class_roster()
        found = False
        for item in roster:
            if isinstance(item, dict) and item.get('name', '').lower() == name.lower():
                if filename_safe:
                    item['photo'] = filename_safe
                if roll_no and roll_no != "-":
                    item['roll_no'] = roll_no
                found = True
                break

        if not found:
            roster.append({
                "name": name,
                "roll_no": roll_no,
                "photo": filename_safe if filename_safe else None,
                "added_at": get_current_now().strftime("%Y-%m-%d %I:%M %p")
            })
        save_class_roster(roster)

        if USE_MONGO and db is not None:
            try:
                update_doc = {"name": name, "roll_no": roll_no, "registered_at": get_current_now()}
                if filename_safe:
                    update_doc["filename"] = filename_safe
                db.registered_faces.update_one(
                    {"name": name},
                    {"$set": update_doc},
                    upsert=True
                )
            except Exception as err:
                print(f"[WARNING] MongoDB face register error: {err}")

        load_known_faces()
        log_activity(f"Saved student details for {name} (Roll No: {roll_no}).", "success")
        return jsonify({"success": True, "message": f"Successfully added {name} (Roll No: {roll_no}) to Student Name List!"})

    except Exception as general_err:
        print(f"[ERROR] register_face failed: {general_err}")
        return jsonify({"success": False, "message": f"Error registering face photo: {str(general_err)}"}), 500


@app.route('/api/delete_student', methods=['POST'])
def delete_student():
    """API to completely delete student across face photos, class roster, attendance CSV logs, and DB."""
    data = request.get_json() or {}
    name = str(data.get('name', '')).strip()

    if not name:
        return jsonify({"success": False, "message": "Student name is required!"}), 400

    deleted_photo = False
    valid_extensions = ('.jpg', '.jpeg', '.png')
    
    # 1. Delete ALL face photo extensions for this student from known_faces directory
    faces_dir = get_known_faces_dir()
    if os.path.exists(faces_dir):
        for filename in os.listdir(faces_dir):
            if filename.lower().endswith(valid_extensions):
                fname_no_ext = os.path.splitext(filename)[0].replace('_', ' ').title()
                if fname_no_ext.lower() == name.lower():
                    fpath = os.path.join(faces_dir, filename)
                    try:
                        os.remove(fpath)
                        deleted_photo = True
                        print(f"[INFO] Deleted reference face photo: {fpath}")
                    except Exception as err:
                        print(f"[ERROR] Deleting face photo {fpath}: {err}")

    # 2. Total delete student records from all class CSV attendance files
    target_csvs = ["attendance_CLASS1.csv", "attendance_ECE2.csv", "attendance_ECE3.csv", "attendance.csv"]
    for csv_file in target_csvs:
        if os.path.exists(csv_file) and os.path.getsize(csv_file) > 0:
            try:
                df = pd.read_csv(csv_file)
                if 'Name' in df.columns:
                    initial_len = len(df)
                    df = df[df['Name'].str.lower() != name.lower()]
                    if len(df) < initial_len:
                        df.to_csv(csv_file, index=False)
                        print(f"[INFO] Purged student records from {csv_file}")
            except Exception as e:
                print(f"[ERROR] Purging student from {csv_file}: {e}")

    # 3. Delete from MongoDB collections if active
    if USE_MONGO and db is not None:
        try:
            db.registered_faces.delete_many({"name": {"$regex": f"^{name}$", "$options": "i"}})
            for code in ["CLASS1", "ECE2", "ECE3"]:
                db[f"attendance_logs_{code}"].delete_many({"name": {"$regex": f"^{name}$", "$options": "i"}})
        except Exception as err:
            print(f"[WARNING] MongoDB delete student error: {err}")

    # 4. Total remove from class roster JSON file
    current_roster = load_class_roster()
    new_roster = [
        s for s in current_roster
        if (s.get('name', '') if isinstance(s, dict) else str(s)).lower() != name.lower()
    ]
    if len(new_roster) != len(current_roster):
        save_class_roster(new_roster)

    # 5. Reload in-memory face encodings immediately
    load_known_faces()
    log_activity(f"Teacher totally deleted student '{name}' and purged all reference data & logs.", "warning")

    return jsonify({"success": True, "message": f"Successfully removed '{name}' from class & purged all data!"})


# --- Class Student Roster & Template APIs ---

@app.route('/api/roster', methods=['GET'])
def get_roster():
    """API returning student roster template list for active class account."""
    roster = load_class_roster()
    return jsonify({
        "success": True,
        "roster": roster,
        "class_code": get_class_code(),
        "total_enrolled": len(roster)
    })


@app.route('/api/roster/add', methods=['POST'])
def add_roster_student():
    """API to add single student (Name, Roll No) to class roster template."""
    data = request.get_json() or {}
    name = str(data.get('name', '')).strip()
    roll_no = str(data.get('roll_no', '')).strip() or "-"

    if not name:
        return jsonify({"success": False, "message": "Student name is required!"}), 400

    roster = load_class_roster()
    # Check if student already exists in roster
    for item in roster:
        item_name = item.get('name', '') if isinstance(item, dict) else str(item)
        if item_name.lower() == name.lower():
            return jsonify({"success": False, "message": f"Student '{name}' is already in class roster!"}), 400

    roster.append({
        "name": name,
        "roll_no": roll_no,
        "added_at": get_current_now().strftime("%Y-%m-%d %I:%M %p")
    })
    save_class_roster(roster)
    log_activity(f"Added student '{name}' (Roll No: {roll_no}) to {get_class_code()} roster template.", "success")

    return jsonify({"success": True, "message": f"Successfully added '{name}' to {get_class_code()} class roster!"})


@app.route('/api/roster/bulk_add', methods=['POST'])
def bulk_add_roster():
    """API to bulk import student name list template (pasted names line-by-line)."""
    data = request.get_json() or {}
    names_text = str(data.get('names_text', '')).strip()

    if not names_text:
        return jsonify({"success": False, "message": "Please paste or enter student names!"}), 400

    raw_lines = [line.strip() for line in names_text.splitlines() if line.strip()]
    if not raw_lines:
        return jsonify({"success": False, "message": "No valid student names found in text!"}), 400

    roster = load_class_roster()
    existing_names = set(
        (item.get('name', '') if isinstance(item, dict) else str(item)).lower()
        for item in roster
    )

    added_count = 0
    for line in raw_lines:
        # Check if line contains "RollNo - Name" or "RollNo, Name" or just "Name"
        parts = line.split('-', 1) if '-' in line else line.split(',', 1)
        if len(parts) == 2 and parts[0].strip().replace(' ', '').isalnum():
            r_no = parts[0].strip()
            s_name = parts[1].strip()
        else:
            r_no = "-"
            s_name = line.strip()

        if s_name and s_name.lower() not in existing_names:
            roster.append({
                "name": s_name,
                "roll_no": r_no,
                "added_at": get_current_now().strftime("%Y-%m-%d %I:%M %p")
            })
            existing_names.add(s_name.lower())
            added_count += 1

    save_class_roster(roster)
    log_activity(f"Bulk imported {added_count} students into {get_class_code()} roster template.", "success")

    return jsonify({
        "success": True,
        "message": f"Successfully added {added_count} student(s) to {get_class_code()} class roster!",
        "added_count": added_count
    })


@app.route('/api/roster/remove', methods=['POST'])
def remove_roster_student():
    """API to remove student from class roster template."""
    data = request.get_json() or {}
    name = str(data.get('name', '')).strip()

    if not name:
        return jsonify({"success": False, "message": "Student name required"}), 400

    roster = load_class_roster()
    initial_len = len(roster)
    new_roster = [
        item for item in roster
        if (item.get('name', '') if isinstance(item, dict) else str(item)).lower() != name.lower()
    ]

    if len(new_roster) == initial_len:
        return jsonify({"success": False, "message": f"Student '{name}' not found in roster."}), 404

    save_class_roster(new_roster)
    log_activity(f"Removed student '{name}' from {get_class_code()} roster template.", "warning")

    return jsonify({"success": True, "message": f"Removed '{name}' from {get_class_code()} roster template!"})


@app.route('/api/clear_attendance', methods=['POST'])
def clear_attendance():
    """API to clear today's class-isolated attendance records."""
    today_date = get_current_now().strftime("%Y-%m-%d")
    target_csv = get_class_csv_path()
    
    if os.path.exists(target_csv) and os.path.getsize(target_csv) > 0:
        try:
            df = pd.read_csv(target_csv)
            df = df[df['Date'] != today_date]
            df.to_csv(target_csv, index=False)
        except Exception as e:
            return jsonify({"success": False, "message": str(e)}), 500

    if USE_MONGO and db is not None:
        try:
            code = get_class_code()
            db[f"attendance_logs_{code}"].delete_many({"date": today_date})
        except Exception as err:
            print(f"[WARNING] MongoDB delete error: {err}")
            
    log_activity(f"Today's attendance log for {get_class_code()} was cleared.", "warning")
    return jsonify({"success": True, "message": f"Today's attendance log for {get_class_code()} has been reset."})


@app.route('/api/export_csv', methods=['GET'])
def export_csv():
    """API to download class-isolated CSV file."""
    target_csv = get_class_csv_path()
    if os.path.exists(target_csv):
        return send_file(target_csv, as_attachment=True, download_name=f"Smart_Attendance_{get_class_code()}.csv")
    return jsonify({"error": "CSV file not found"}), 444


@app.route('/api/export_excel', methods=['GET'])
def export_excel():
    """API to export class-isolated attendance to a multi-sheet Excel file (.xlsx)."""
    target_csv = get_class_csv_path()
    if not os.path.exists(target_csv) or os.path.getsize(target_csv) == 0:
        return jsonify({"error": "No attendance records found for this class."}), 404

    month_param = request.args.get('month', '').strip()  # e.g., "2026-07"
    date_param = request.args.get('date', '').strip()    # e.g., "2026-07-26"
    class_code = get_class_code()

    try:
        df = pd.read_csv(target_csv)
        for col in CSV_COLUMNS:
            if col not in df.columns:
                df[col] = "-"

        if date_param:
            df = df[df['Date'] == date_param]
            report_label = f"{class_code}_Date_{date_param}"
        elif month_param and month_param.lower() != 'all':
            df = df[df['Date'].str.startswith(month_param)]
            report_label = f"{class_code}_Month_{month_param}"
        else:
            report_label = f"{class_code}_Full_Monthly_Report"

        if df.empty:
            return jsonify({"error": "No records match the selected month or date filter."}), 404

        excel_filename = f"Smart_Attendance_{report_label}.xlsx"
        excel_path = os.path.join(os.getcwd(), excel_filename)

        with pd.ExcelWriter(excel_path, engine='openpyxl') as writer:
            unique_names = sorted(list(set(df['Name'].tolist() + known_face_names)))
            unique_dates = sorted(df['Date'].unique().tolist())

            summary_rows = []
            total_unique_days = max(1, len(unique_dates))

            for person in unique_names:
                person_df = df[df['Name'].str.lower() == person.lower()]
                total_present = len(person_df)
                on_time_count = sum(1 for s in person_df['Status'] if str(s).strip() == 'On Time')
                late_count = sum(1 for s in person_df['Status'] if str(s).strip() == 'Late')
                od_count = sum(1 for s in person_df['Status'] if 'OD' in str(s).upper() or 'DUTY' in str(s).upper())

                pct = min(100, round((total_present / total_unique_days) * 100))

                row_dict = {
                    "Student / Person": person,
                    "Class Code": class_code,
                    "Attendance Rate (%)": f"{pct}%",
                    "Total Days Present": f"{total_present} / {total_unique_days}",
                    "On Time Count": on_time_count,
                    "Late Count": late_count,
                    "OD (On Duty) Count": od_count
                }

                for d in unique_dates:
                    day_rec = person_df[person_df['Date'] == d]
                    if not day_rec.empty:
                        r = day_rec.iloc[0]
                        in_t = r.get('In_Time', '-')
                        out_t = r.get('Out_Time', '-')
                        st = r.get('Status', '-')
                        rem = r.get('Remarks', '-')
                        row_dict[d] = f"{st} (In: {in_t} | Out: {out_t} | Note: {rem})"
                    else:
                        row_dict[d] = "Absent"

                summary_rows.append(row_dict)

            summary_df = pd.DataFrame(summary_rows)
            summary_df.to_excel(writer, sheet_name=f"{class_code} Summary Matrix", index=False)

            if unique_dates:
                for date_str in unique_dates:
                    date_df = df[df['Date'] == date_str]
                    sheet_name = f"Date_{date_str}"[:31]
                    date_df.to_excel(writer, sheet_name=sheet_name, index=False)
            else:
                df.to_excel(writer, sheet_name="All Attendance Logs", index=False)

        return send_file(excel_path, as_attachment=True, download_name=excel_filename)

    except Exception as e:
        print(f"[ERROR] Excel export failed: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    print("=========================================================")
    print("  Smart Face Recognition Attendance System Server Running  ")
    print(f"  MongoDB Database: {'Connected (' + DB_NAME + ')' if USE_MONGO else 'CSV Fallback Active'}")
    print(f"  Access URL:  http://0.0.0.0:{port}  ")
    print("=========================================================")
    app.run(host='0.0.0.0', port=port, debug=False)

