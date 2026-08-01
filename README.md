# 🌲 SmartAttendancePortal

> **Real-Time Face Match & Classroom Surveillance System**  
> A modern, high-performance, dark-mode web application designed for real-time automated attendance tracking, facial recognition, and classroom surveillance. Built with Flask, OpenCV, MediaPipe, JavaScript, and an Emerald Mint futuristic design.

[![Live Demo](https://img.shields.io/badge/Live_Demo-Render-00ff9d?style=for-the-badge&logo=render)](https://smart-web-attendance.onrender.com)
[![Python](https://img.shields.io/badge/Python-3.10+-blue?style=for-the-badge&logo=python)](https://python.org)
[![Flask](https://img.shields.io/badge/Framework-Flask-green?style=for-the-badge&logo=flask)](https://flask.palletsprojects.com)
[![License](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)](LICENSE)

---

## ✨ Features

- **🌲 Emerald Mint Theme**: Sleek, futuristic dark UI with glowing neon accents, 3D HUD crosshair reticle, laser sweep animations, and responsive 3-column layout.
- **⚡ Real-Time Face Scanner**: Multi-engine face detection using MediaPipe Deep Learning & OpenCV Cascade fallback supporting host PC webcam and client/device webcams.
- **📊 Metric Statistics**: Real-time counter cards for *Total Present Today*, *On Time*, *Late Arrival*, *OD (On Duty)*, *Total Absent Today*, and *Enrolled Students*.
- **📋 Daily & Monthly Attendance Matrix**: Complete automated logging with attendance percentages, manual teacher overrides, and OD approvals.
- **📑 Multi-Format Export**: One-click exports for Monthly Excel (`.xlsx`) reports, PDF summaries, and CSV backups.
- **🎥 Live Classroom Surveillance & 24h Clips**: Real-time camera streaming with 24-hour auto-expiring video clip management.
- **🕒 Time Synchronization**: Built-in clock sync modal for custom cutoff time overrides and shift adjustments.

---

## 🛠️ Tech Stack

- **Backend**: Python 3.10+, Flask, Pandas, NumPy, OpenCV, MediaPipe
- **Frontend**: HTML5, Vanilla CSS3 (Custom Theme Variables & Glassmorphism), JavaScript (ES6+), FontAwesome 6, Google Fonts (*Outfit*, *Space Grotesk*, *Inter*)
- **Deployment**: Render Docker / Web Service Container

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/karthikrajan22032010-oss/Smart_Web_Attendance.git
cd Smart_Web_Attendance
```

### 2. Set Up Virtual Environment & Dependencies
```bash
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Run the Local Server
```bash
python app.py
```
Open your browser and navigate to `http://localhost:5000`.

---

## 📁 Project Structure

```
Smart_Web_Attendance/
├── app.py                  # Main Flask Server & API Routes
├── requirements.txt        # Python Dependencies
├── Dockerfile              # Docker Container Config
├── static/
│   ├── css/
│   │   └── style.css       # Emerald Mint Design System & Styles
│   ├── js/
│   │   └── main.js         # Client Logic, Camera Processor & Interactivity
│   └── images/             # Application Logos & Assets
├── templates/
│   └── index.html          # Main Dashboard Template
├── known_faces/            # Enrolled Face Embeddings & Reference Images
└── recorded_videos/        # 24h Auto-Deleted Video Surveillance Clips
```

---

## 👨‍💻 Author & Credits

Designed & Developed by **MAYANDI KARTHIK RAJAN**  
GitHub: [@karthikrajan22032010-oss](https://github.com/karthikrajan22032010-oss)

---

<p center-align="true">
  <em>&lt;/&gt; Designed &amp; Developed by MAYANDI KARTHIK RAJAN</em>
</p>
