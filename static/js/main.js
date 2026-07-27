document.addEventListener('DOMContentLoaded', () => {
    // Theme Selector Logic
    const themeSelector = document.getElementById('themeSelector');
    const savedTheme = localStorage.getItem('portalTheme') || 'sapphire';
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (themeSelector) {
        themeSelector.value = savedTheme;
        themeSelector.addEventListener('change', (e) => {
            const selected = e.target.value;
            document.documentElement.setAttribute('data-theme', selected);
            localStorage.setItem('portalTheme', selected);
            showToast(`Theme changed to ${e.target.options[e.target.selectedIndex].text}!`, 'success');
        });
    }
    // DOM Elements
    const loginSection = document.getElementById('loginSection');
    const dashboardSection = document.getElementById('dashboardSection');
    const loginForm = document.getElementById('loginForm');
    const loginIdInput = document.getElementById('loginId');
    const loginPassInput = document.getElementById('loginPass');
    const loginErrorMsg = document.getElementById('loginErrorMsg');
    const activeClassNameEl = document.getElementById('activeClassName');
    const btnLogout = document.getElementById('btnLogout');
    const btnTogglePass = document.getElementById('btnTogglePass');
    const eyeIcon = document.getElementById('eyeIcon');

    const btnSelectClass1 = document.getElementById('btnSelectClass1');
    const btnSelectClass2 = document.getElementById('btnSelectClass2');

    const liveClockEl = document.getElementById('liveClock');
    const tableBody = document.getElementById('attendanceTableBody');
    const searchInput = document.getElementById('searchInput');

    // Stats counter elements
    const statTotal = document.getElementById('statTotal');
    const statOnTime = document.getElementById('statOnTime');
    const statLate = document.getElementById('statLate');
    const statEnrolled = document.getElementById('statEnrolled');

    // Modals & Buttons
    const manualModal = document.getElementById('manualModal');
    const registerModal = document.getElementById('registerModal');
    const openManualModalBtn = document.getElementById('openManualModalBtn');
    const openRegisterModalBtn = document.getElementById('openRegisterModalBtn');
    const closeManualModalBtn = document.getElementById('closeManualModalBtn');
    const closeRegisterModalBtn = document.getElementById('closeRegisterModalBtn');
    const cancelManualBtn = document.getElementById('cancelManualBtn');
    const cancelRegisterBtn = document.getElementById('cancelRegisterBtn');
    const btnClearLog = document.getElementById('btnClearLog');

    // Forms
    const manualEntryForm = document.getElementById('manualEntryForm');
    const registerFaceForm = document.getElementById('registerFaceForm');

    // State cache
    let cachedAttendance = [];
    let cachedMonthlyData = { records: [], names: [], dates: [] };
    let cachedRegisteredStudents = [];

    let cachedStudentStats = {};
    let serverTimeOffsetMinutes = 0;

    // 1. Live Digital Clock & Date
    function updateClock() {
        let now = new Date();
        if (serverTimeOffsetMinutes !== 0) {
            now = new Date(now.getTime() + serverTimeOffsetMinutes * 60 * 1000);
        }
        const dateOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
        const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
        
        const dateStr = now.toLocaleDateString('en-US', dateOptions);
        const timeStr = now.toLocaleTimeString('en-US', timeOptions);

        const liveDateStrEl = document.getElementById('liveDateStr');
        const liveClockStrEl = document.getElementById('liveClockStr');

        if (liveDateStrEl) liveDateStrEl.textContent = dateStr;
        if (liveClockStrEl) liveClockStrEl.textContent = timeStr;
    }
    setInterval(updateClock, 1000);
    updateClock();

    // Time Sync Modal Elements
    const syncTimeModal = document.getElementById('syncTimeModal');
    const btnOpenSyncTimeModal = document.getElementById('btnOpenSyncTimeModal');
    const liveDateClockBtn = document.getElementById('liveDateClock');
    const closeSyncTimeModalBtn = document.getElementById('closeSyncTimeModalBtn');
    const cancelSyncTimeBtn = document.getElementById('cancelSyncTimeBtn');
    const syncTimeForm = document.getElementById('syncTimeForm');
    const customTimeInput = document.getElementById('customTimeInput');
    const btnPreset405PM = document.getElementById('btnPreset405PM');
    const btnPresetResetPC = document.getElementById('btnPresetResetPC');

    const openSyncModal = () => {
        if (syncTimeModal) syncTimeModal.classList.add('active');
    };

    const closeSyncModal = () => {
        if (syncTimeModal) syncTimeModal.classList.remove('active');
    };

    if (btnOpenSyncTimeModal) btnOpenSyncTimeModal.addEventListener('click', openSyncModal);
    if (liveDateClockBtn) liveDateClockBtn.addEventListener('click', openSyncModal);
    if (closeSyncTimeModalBtn) closeSyncTimeModalBtn.addEventListener('click', closeSyncModal);
    if (cancelSyncTimeBtn) cancelSyncTimeBtn.addEventListener('click', closeSyncModal);

    async function applyTimeSync(customTime, isReset = false) {
        try {
            const body = isReset ? { reset: true } : { custom_time: customTime };
            const res = await fetch('/api/set_time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (res.ok && data.success) {
                serverTimeOffsetMinutes = data.offset || 0;
                showToast(data.message || 'Time synced!', 'success');
                closeSyncModal();
                fetchAttendanceData();
                updateClock();
            } else {
                showToast(data.message || 'Failed to sync time', 'danger');
            }
        } catch (err) {
            showToast('Error syncing time with server', 'danger');
        }
    }

    if (btnPreset405PM) {
        btnPreset405PM.addEventListener('click', () => {
            applyTimeSync('04:05 PM');
        });
    }

    if (btnPresetResetPC) {
        btnPresetResetPC.addEventListener('click', () => {
            applyTimeSync('', true);
        });
    }

    if (syncTimeForm) {
        syncTimeForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const val = customTimeInput ? customTimeInput.value.trim() : '';
            if (val) {
                applyTimeSync(val);
            }
        });
    }

    // 2. Authentication Check & Session Management
    async function checkAuthSession() {
        try {
            const res = await fetch('/api/current_user');
            if (res.ok) {
                const data = await res.json();
                if (data.logged_in) {
                    showDashboard(data.class_name);
                } else {
                    showLogin();
                }
            }
        } catch (err) {
            console.error("Error checking auth session:", err);
            showLogin();
        }
    }

    // Camera Control State System
    let isCameraActive = false;

    function startCamera() {
        const serverVideoImg = document.getElementById('serverVideoImg');
        const camStandbyScreen = document.getElementById('camStandbyScreen');
        const camStatusMsg = document.getElementById('camStatusMsg');
        const btnToggleCamera = document.getElementById('btnToggleCamera');
        const videoOverlayHUD = document.getElementById('videoOverlayHUD');

        isCameraActive = true;
        if (serverVideoImg) serverVideoImg.src = '/video_feed?' + new Date().getTime();
        if (camStandbyScreen) camStandbyScreen.style.display = 'none';
        if (videoOverlayHUD) videoOverlayHUD.style.display = 'block';

        if (camStatusMsg) {
            camStatusMsg.innerHTML = `<i class="fa-solid fa-shield-halved text-success"></i> OpenCV Face Match Active`;
        }
        if (btnToggleCamera) {
            btnToggleCamera.className = 'btn btn-danger btn-sm';
            btnToggleCamera.innerHTML = `<i class="fa-solid fa-power-off"></i> Turn Camera OFF`;
        }
    }

    function stopCamera() {
        const serverVideoImg = document.getElementById('serverVideoImg');
        const camStandbyScreen = document.getElementById('camStandbyScreen');
        const camStatusMsg = document.getElementById('camStatusMsg');
        const btnToggleCamera = document.getElementById('btnToggleCamera');
        const videoOverlayHUD = document.getElementById('videoOverlayHUD');

        isCameraActive = false;
        if (serverVideoImg) serverVideoImg.src = '';
        if (camStandbyScreen) camStandbyScreen.style.display = 'flex';
        if (videoOverlayHUD) videoOverlayHUD.style.display = 'none';

        if (camStatusMsg) {
            camStatusMsg.innerHTML = `<i class="fa-solid fa-video-slash text-danger"></i> Camera Standby (OFF)`;
        }
        if (btnToggleCamera) {
            btnToggleCamera.className = 'btn btn-success btn-sm';
            btnToggleCamera.innerHTML = `<i class="fa-solid fa-power-off"></i> Turn Camera ON`;
        }
    }

    function toggleCamera() {
        if (isCameraActive) {
            stopCamera();
            showToast('Camera turned OFF', 'warning');
        } else {
            startCamera();
            showToast('Camera turned ON', 'success');
        }
    }

    const btnToggleCamera = document.getElementById('btnToggleCamera');
    if (btnToggleCamera) {
        btnToggleCamera.addEventListener('click', toggleCamera);
    }

    function showLogin() {
        if (loginSection) loginSection.style.display = 'flex';
        if (dashboardSection) dashboardSection.style.display = 'none';
        stopCamera();
    }

    function showDashboard(className) {
        if (loginSection) loginSection.style.display = 'none';
        if (dashboardSection) dashboardSection.style.display = 'flex';
        if (activeClassNameEl) activeClassNameEl.textContent = className || 'Classroom';
        fetchAttendanceData();
        startCamera();
    }

    // Quick Class Chips
    const btnSelectClass0 = document.getElementById('btnSelectClass0');
    if (btnSelectClass0) {
        btnSelectClass0.addEventListener('click', () => {
            loginIdInput.value = 'CLASS 1';
            loginPassInput.value = '123456789';
            if (loginErrorMsg) loginErrorMsg.style.display = 'none';
        });
    }

    if (btnSelectClass1) {
        btnSelectClass1.addEventListener('click', () => {
            loginIdInput.value = 'ECE 2YEAR@LAPC';
            loginPassInput.value = '123456789';
            if (loginErrorMsg) loginErrorMsg.style.display = 'none';
        });
    }

    if (btnSelectClass2) {
        btnSelectClass2.addEventListener('click', () => {
            loginIdInput.value = 'ECE 3YEAR@LAPC';
            loginPassInput.value = '123456789';
            if (loginErrorMsg) loginErrorMsg.style.display = 'none';
        });
    }

    // Password Toggle
    if (btnTogglePass) {
        btnTogglePass.addEventListener('click', () => {
            const isPass = loginPassInput.type === 'password';
            loginPassInput.type = isPass ? 'text' : 'password';
            eyeIcon.className = isPass ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        });
    }

    let loginCooldownTimer = null;
    let cooldownSecondsLeft = 0;

    function triggerLoginError(msg, errorType) {
        if (loginIdInput) loginIdInput.classList.remove('input-error');
        if (loginPassInput) loginPassInput.classList.remove('input-error');

        if (errorType === 'id' && loginIdInput) {
            loginIdInput.classList.add('input-error');
            loginIdInput.focus();
        } else if (errorType === 'password' && loginPassInput) {
            loginPassInput.classList.add('input-error');
            loginPassInput.focus();
        }

        if (loginErrorMsg) {
            loginErrorMsg.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${escapeHtml(msg)}`;
            loginErrorMsg.style.display = 'block';
        }
    }

    function startLoginCooldown(seconds = 60) {
        const btnSubmit = document.getElementById('btnLoginSubmit');
        cooldownSecondsLeft = seconds;

        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.classList.add('btn-locked');
        }

        if (loginCooldownTimer) clearInterval(loginCooldownTimer);

        loginCooldownTimer = setInterval(() => {
            cooldownSecondsLeft--;
            if (btnSubmit) {
                btnSubmit.innerHTML = `<span><i class="fa-solid fa-lock text-warning"></i> Security Lock (${cooldownSecondsLeft}s)</span>`;
            }

            if (loginErrorMsg && cooldownSecondsLeft > 0) {
                loginErrorMsg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Wrong Login ID or Password!</strong><br><small style="color: var(--danger);">Security Cooldown Active: <strong>${cooldownSecondsLeft} seconds</strong> remaining.</small>`;
                loginErrorMsg.style.display = 'block';
            }

            if (cooldownSecondsLeft <= 0) {
                clearInterval(loginCooldownTimer);
                loginCooldownTimer = null;
                if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.classList.remove('btn-locked');
                    btnSubmit.innerHTML = `<span>Login to Classroom Dashboard</span> <i class="fa-solid fa-arrow-right-to-bracket"></i>`;
                }
                if (loginErrorMsg) {
                    loginErrorMsg.style.display = 'none';
                }
                if (loginIdInput) loginIdInput.classList.remove('input-error');
                if (loginPassInput) loginPassInput.classList.remove('input-error');
            }
        }, 1000);
    }

    // Submit Login Form
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (cooldownSecondsLeft > 0) {
                showToast(`Security lock active. Please wait ${cooldownSecondsLeft}s.`, 'warning');
                return;
            }

            const login_id = loginIdInput.value.trim();
            const password = loginPassInput.value.trim();

            if (!login_id || !password) return;

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login_id, password })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    if (loginIdInput) loginIdInput.classList.remove('input-error');
                    if (loginPassInput) loginPassInput.classList.remove('input-error');
                    if (loginErrorMsg) loginErrorMsg.style.display = 'none';
                    showToast(data.message || 'Login Successful!', 'success');
                    showDashboard(data.class_name);
                } else {
                    triggerLoginError(data.message || 'Invalid Login ID or Password!', data.error_type || 'password');
                    showToast(data.message || 'Invalid Login Credentials', 'danger');
                }
            } catch (err) {
                showToast('Server connection error during login.', 'danger');
            }
        });
    }

    // Logout
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            try {
                await fetch('/api/logout', { method: 'POST' });
                showToast('Logged out of class portal.', 'success');
                showLogin();
            } catch (err) {
                showLogin();
            }
        });
    }

    // 3. Tab Navigation System (3 Positions)
    const navTabs = document.querySelectorAll('.nav-tab');
    const tabContents = document.querySelectorAll('.tab-content');

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-tab');

            navTabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const targetContent = document.getElementById(targetId);
            if (targetContent) targetContent.classList.add('active');

            if (targetId === 'posMonthly') {
                fetchMonthlyAttendance();
            } else if (targetId === 'posSurveillance') {
                fetchSurveillanceData();
            }
        });
    });

    // 4. Fetch Daily Attendance & Stats (Position 1)
    async function fetchAttendanceData() {
        try {
            const response = await fetch('/api/attendance');
            if (!response.ok) return;
            
            const data = await response.json();
            cachedAttendance = data.attendance || [];
            cachedRegisteredStudents = data.registered_students || [];
            cachedStudentStats = data.student_stats || {};

            if (data.current_time_info && data.current_time_info.offset_minutes !== undefined) {
                serverTimeOffsetMinutes = data.current_time_info.offset_minutes;
                updateClock();
            }
            
            if (data.class_name && activeClassNameEl) {
                activeClassNameEl.textContent = data.class_name;
            }

            if (data.stats) {
                if (statTotal) statTotal.textContent = data.stats.total || 0;
                if (statOnTime) statOnTime.textContent = data.stats.on_time || 0;
                if (statLate) statLate.textContent = data.stats.late || 0;
                const statOD = document.getElementById('statOD');
                if (statOD) statOD.textContent = data.stats.od_count || 0;
                const statAbsent = document.getElementById('statAbsent');
                if (statAbsent) statAbsent.textContent = data.stats.absent || 0;
                if (statEnrolled) statEnrolled.textContent = data.stats.enrolled || 0;
            }
            
            if (data.mongo_status) {
                const mongoStatusEl = document.getElementById('mongoStatus');
                if (mongoStatusEl) mongoStatusEl.textContent = data.mongo_status;
            }

            renderDailyTable();
            renderRegisteredStudentsManageList();
        } catch (err) {
            console.error("Error fetching daily attendance:", err);
        }
    }

    // --- Device WebRTC Camera Controller ---
    let clientMediaStream = null;
    let clientFrameInterval = null;
    let currentFacingMode = 'user'; // 'user' (front) or 'environment' (back)
    let isUsingDeviceCam = false;

    const serverVideoImg = document.getElementById('serverVideoImg');
    const clientVideo = document.getElementById('clientVideo');
    const clientCanvas = document.getElementById('clientCanvas');
    const btnToggleCamSource = document.getElementById('btnToggleCamSource');
    const btnFlipCam = document.getElementById('btnFlipCam');
    const camStatusMsg = document.getElementById('camStatusMsg');

    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    async function startDeviceCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showToast('Device camera access not supported on this browser.', 'danger');
            return;
        }

        try {
            if (clientMediaStream) {
                clientMediaStream.getTracks().forEach(track => track.stop());
            }

            const constraints = {
                video: {
                    facingMode: currentFacingMode,
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: false
            };

            clientMediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            if (clientVideo) {
                clientVideo.srcObject = clientMediaStream;
                clientVideo.style.display = 'block';
                await clientVideo.play();
            }

            if (serverVideoImg) serverVideoImg.style.display = 'none';
            if (btnFlipCam) btnFlipCam.style.display = 'inline-flex';
            if (btnToggleCamSource) {
                btnToggleCamSource.innerHTML = `<i class="fa-solid fa-server"></i> Use Server Camera`;
            }

            if (camStatusMsg) {
                camStatusMsg.innerHTML = `<i class="fa-solid fa-mobile-screen text-success"></i> Device Camera Active`;
            }

            isUsingDeviceCam = true;
            startClientFrameProcessing();
            showToast('Using Device Camera!', 'success');

        } catch (err) {
            console.error("Device Camera error:", err);
            showToast(`Could not access device camera: ${err.message}`, 'danger');
            stopDeviceCamera();
        }
    }

    function stopDeviceCamera() {
        if (clientMediaStream) {
            clientMediaStream.getTracks().forEach(track => track.stop());
            clientMediaStream = null;
        }

        if (clientFrameInterval) {
            clearInterval(clientFrameInterval);
            clientFrameInterval = null;
        }

        if (clientVideo) clientVideo.style.display = 'none';
        if (serverVideoImg) serverVideoImg.style.display = 'block';
        if (btnFlipCam) btnFlipCam.style.display = 'none';
        if (btnToggleCamSource) {
            btnToggleCamSource.innerHTML = `<i class="fa-solid fa-mobile-screen"></i> Use Device Camera`;
        }

        if (camStatusMsg) {
            camStatusMsg.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Server Camera Stream Active`;
        }

        isUsingDeviceCam = false;
    }

    function startClientFrameProcessing() {
        if (clientFrameInterval) clearInterval(clientFrameInterval);

        clientFrameInterval = setInterval(async () => {
            if (!isUsingDeviceCam || !clientVideo || clientVideo.paused || clientVideo.ended) return;

            try {
                const width = clientVideo.videoWidth || 640;
                const height = clientVideo.videoHeight || 480;

                if (!clientCanvas) return;
                clientCanvas.width = width;
                clientCanvas.height = height;

                const ctx = clientCanvas.getContext('2d');
                ctx.drawImage(clientVideo, 0, 0, width, height);

                const dataUrl = clientCanvas.toDataURL('image/jpeg', 0.6);

                const res = await fetch('/api/process_client_frame', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: dataUrl })
                });

                if (res.ok) {
                    const result = await res.json();
                    if (result.success && result.detected_faces && result.detected_faces.length > 0) {
                        const names = result.detected_faces.map(f => f.name).join(', ');
                        if (camStatusMsg) {
                            camStatusMsg.innerHTML = `<i class="fa-solid fa-face-smile text-success"></i> Detected: <strong>${escapeHtml(names)}</strong>`;
                        }
                    }
                }
            } catch (err) {
                console.error("Frame processing error:", err);
            }
        }, 700);
    }

    if (btnToggleCamSource) {
        btnToggleCamSource.addEventListener('click', () => {
            if (isUsingDeviceCam) {
                stopDeviceCamera();
            } else {
                startDeviceCamera();
            }
        });
    }

    if (btnFlipCam) {
        btnFlipCam.addEventListener('click', () => {
            currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
            startDeviceCamera();
        });
    }

    // Function to render student checkboxes inside modal
    function renderStudentCheckboxes() {
        const container = document.getElementById('studentCheckboxList');
        if (!container) return;

        if (cachedRegisteredStudents.length === 0) {
            container.innerHTML = `<span class="text-muted small">No registered students yet. Type name below.</span>`;
            return;
        }

        container.innerHTML = cachedRegisteredStudents.map(student => {
            return `
                <label class="checkbox-item">
                    <input type="checkbox" class="student-checkbox" value="${escapeHtml(student)}">
                    <span>${escapeHtml(student)}</span>
                </label>
            `;
        }).join('');
    }

    // Function to render registered students list with Delete buttons inside Modal 2
    function renderRegisteredStudentsManageList() {
        const container = document.getElementById('registeredStudentsManageList');
        const badge = document.getElementById('registeredStudentsCountBadge');
        if (!container) return;

        if (badge) {
            badge.textContent = `${cachedRegisteredStudents.length} Enrolled`;
        }

        if (cachedRegisteredStudents.length === 0) {
            container.innerHTML = `<span class="text-muted small">No registered students found. Upload a face photo above to train.</span>`;
            return;
        }

        container.innerHTML = cachedRegisteredStudents.map(student => {
            return `
                <div class="student-manage-item" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-color); border-radius: 8px;">
                    <span style="font-weight: 600; color: var(--text-main); font-size: 13px;"><i class="fa-solid fa-circle-user text-primary" style="margin-right: 6px;"></i> ${escapeHtml(student)}</span>
                    <button type="button" class="btn btn-danger btn-xs btnDeleteStudent" data-name="${escapeHtml(student)}" title="Delete student and remove face recognition model">
                        <i class="fa-solid fa-trash-can"></i> Delete
                    </button>
                </div>
            `;
        }).join('');

        // Attach Delete Student Click Handler
        container.querySelectorAll('.btnDeleteStudent').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                if (!name) return;

                if (!confirm(`Are you sure you want to delete student "${name}" and remove their face recognition data?`)) {
                    return;
                }

                try {
                    const res = await fetch('/api/delete_student', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name })
                    });

                    const data = await res.json();
                    if (res.ok && data.success) {
                        showToast(data.message || `Successfully deleted student ${name}!`, 'success');
                        fetchAttendanceData();
                    } else {
                        showToast(data.message || `Failed to delete student ${name}.`, 'danger');
                    }
                } catch (err) {
                    console.error("Error deleting student:", err);
                    showToast('Error connecting to server to delete student.', 'danger');
                }
            });
        });
    }

    // Select All / Unselect All
    const btnSelectAllNames = document.getElementById('btnSelectAllNames');
    const btnUnselectAllNames = document.getElementById('btnUnselectAllNames');

    if (btnSelectAllNames) {
        btnSelectAllNames.addEventListener('click', () => {
            document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = true);
        });
    }

    if (btnUnselectAllNames) {
        btnUnselectAllNames.addEventListener('click', () => {
            document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = false);
        });
    }

    // Render Position 1 Daily Table
    function renderDailyTable() {
        if (!tableBody) return;
        const filterText = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const filtered = cachedAttendance.filter(item => {
            const nameMatch = (item.Name || '').toLowerCase().includes(filterText);
            const statusMatch = (item.Status || '').toLowerCase().includes(filterText);
            const inTimeMatch = (item.In_Time || item.Time || '').toLowerCase().includes(filterText);
            const remarksMatch = (item.Remarks || '').toLowerCase().includes(filterText);
            return nameMatch || statusMatch || inTimeMatch || remarksMatch;
        });

        if (filtered.length === 0) {
            tableBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="11">
                        <div class="empty-state">
                            <i class="fa-solid fa-clipboard-question"></i>
                            <p>${cachedAttendance.length === 0 ? 'No attendance logged today yet.' : 'No matching records found.'}</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = filtered.map((item, index) => {
            const st = (item.Status || '').toUpperCase();
            let badgeClass = 'badge-ontime';
            let iconClass = 'fa-circle-check';

            if (st.includes('OD') || st.includes('DUTY')) {
                badgeClass = 'badge-od';
                iconClass = 'fa-id-badge';
            } else if (st.includes('PERMISSION')) {
                badgeClass = 'badge-permission';
                iconClass = 'fa-user-clock';
            } else if (st.includes('LATE')) {
                badgeClass = 'badge-late';
                iconClass = 'fa-triangle-exclamation';
            }

            const pStats = cachedStudentStats[item.Name] || { percentage: 100 };
            const studentPct = pStats.percentage !== undefined ? pStats.percentage : 100;
            const pctBadgeClass = studentPct >= 80 ? 'badge-ontime' : (studentPct >= 50 ? 'badge-od' : 'badge-late');

            const inTime = item.In_Time || item.Time || '-';
            const outTime = item.Out_Time || '-';
            const mornBreak = item.Morning_Break || '-';
            const lunchBreak = item.Lunch_Break || '-';
            const eveBreak = item.Evening_Break || '-';
            const remarks = item.Remarks || '-';

            return `
                <tr>
                    <td><strong>${index + 1}</strong></td>
                    <td><i class="fa-solid fa-circle-user text-muted" style="margin-right: 6px;"></i> ${escapeHtml(item.Name)}</td>
                    <td><span class="badge ${pctBadgeClass}">${studentPct}%</span></td>
                    <td>${escapeHtml(item.Date)}</td>
                    <td><span class="text-success" style="font-weight: 500;">${escapeHtml(inTime)}</span></td>
                    <td><span class="text-info" style="font-weight: 500;">${escapeHtml(outTime)}</span></td>
                    <td>
                        <span class="badge ${badgeClass}">
                            <i class="fa-solid ${iconClass}"></i> ${escapeHtml(item.Status)}
                        </span>
                    </td>
                    <td><small class="text-muted">${escapeHtml(mornBreak)}</small></td>
                    <td><small class="text-muted">${escapeHtml(lunchBreak)}</small></td>
                    <td><small class="text-muted">${escapeHtml(eveBreak)}</small></td>
                    <td><small class="text-info">${escapeHtml(remarks)}</small></td>
                </tr>
            `;
        }).join('');
    }

    if (searchInput) searchInput.addEventListener('input', renderDailyTable);

    // 5. Fetch Monthly Attendance (Position 2)
    async function fetchMonthlyAttendance() {
        try {
            const response = await fetch('/api/monthly_attendance');
            if (!response.ok) return;

            cachedMonthlyData = await response.json();
            renderMonthlyTable();
        } catch (err) {
            console.error("Error fetching monthly data:", err);
        }
    }

    function renderMonthlyTable() {
        const monthlyHead = document.getElementById('monthlyTableHead');
        const monthlyBody = document.getElementById('monthlyTableBody');
        const searchVal = document.getElementById('monthlySearchInput') ? document.getElementById('monthlySearchInput').value.toLowerCase().trim() : '';

        if (!monthlyHead || !monthlyBody) return;

        const records = cachedMonthlyData.records || [];
        const names = (cachedMonthlyData.names || []).filter(n => n.toLowerCase().includes(searchVal));
        const dates = cachedMonthlyData.dates || [];
        const totalUniqueDates = dates.length || 1;

        let headHTML = `<tr>
            <th>Student / Person</th>
            <th>Attendance %</th>
            <th>Total Present</th>
            <th>On Time</th>
            <th>Late</th>
            <th>OD</th>`;
        
        dates.forEach(d => {
            headHTML += `<th>${escapeHtml(d)}</th>`;
        });
        headHTML += `</tr>`;
        monthlyHead.innerHTML = headHTML;

        if (names.length === 0) {
            monthlyBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="${6 + dates.length}">
                        <div class="empty-state">
                            <i class="fa-solid fa-calendar-xmark"></i>
                            <p>No monthly attendance records found.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        let bodyHTML = '';
        names.forEach(person => {
            const personRecs = records.filter(r => r.Name.toLowerCase() === person.toLowerCase());
            const totalPresent = personRecs.length;
            const onTimeCount = personRecs.filter(r => (r.Status || '').trim() === 'On Time').length;
            const lateCount = personRecs.filter(r => (r.Status || '').trim() === 'Late').length;
            const odCount = personRecs.filter(r => (r.Status || '').toUpperCase().includes('OD')).length;
            
            const attendancePct = Math.min(100, Math.round((totalPresent / totalUniqueDates) * 100));
            const pctBadgeClass = attendancePct >= 80 ? 'badge-ontime' : (attendancePct >= 50 ? 'badge-od' : 'badge-late');

            bodyHTML += `<tr>
                <td><strong><i class="fa-solid fa-circle-user text-muted" style="margin-right: 6px;"></i> ${escapeHtml(person)}</strong></td>
                <td><span class="badge ${pctBadgeClass}">${attendancePct}%</span></td>
                <td><span class="text-info" style="font-weight:600;">${totalPresent} / ${totalUniqueDates} Days</span></td>
                <td><span class="text-success" style="font-weight:600;">${onTimeCount}</span></td>
                <td><span class="text-danger" style="font-weight:600;">${lateCount}</span></td>
                <td><span style="color: #c084fc; font-weight:600;">${odCount}</span></td>`;

            dates.forEach(d => {
                const dayMatch = personRecs.find(r => r.Date === d);
                if (dayMatch) {
                    const st = dayMatch.Status || 'Present';
                    const inT = dayMatch.In_Time || dayMatch.Time || '';
                    const outT = dayMatch.Out_Time || '';
                    const remarks = dayMatch.Remarks || '';
                    
                    const isLate = st.toLowerCase().includes('late');
                    const isOD = st.toLowerCase().includes('od');
                    const colorStyle = isOD ? 'color: #c084fc;' : (isLate ? 'color: var(--danger);' : 'color: var(--success);');

                    bodyHTML += `<td>
                        <small style="${colorStyle} font-weight: 600;">
                            <i class="fa-solid ${isOD ? 'fa-id-badge' : (isLate ? 'fa-circle-exclamation' : 'fa-circle-check')}"></i> ${escapeHtml(st)}
                            <br><span class="text-muted" style="font-weight: normal;">In: ${escapeHtml(inT)}</span>
                            ${outT && outT !== '-' ? `<br><span class="text-muted" style="font-weight: normal;">Out: ${escapeHtml(outT)}</span>` : ''}
                            ${remarks && remarks !== '-' ? `<br><span class="text-info" style="font-size: 10px;">Note: ${escapeHtml(remarks)}</span>` : ''}
                        </small>
                    </td>`;
                } else {
                    bodyHTML += `<td><span class="badge badge-late" style="opacity: 0.6;">Absent</span></td>`;
                }
            });

            bodyHTML += `</tr>`;
        });

        monthlyBody.innerHTML = bodyHTML;
    }

    const monthlySearchInput = document.getElementById('monthlySearchInput');
    if (monthlySearchInput) monthlySearchInput.addEventListener('input', renderMonthlyTable);

    // 6. Fetch Surveillance & 24h Videos (Position 3)
    async function fetchSurveillanceData() {
        try {
            const logRes = await fetch('/api/surveillance_logs');
            if (logRes.ok) {
                const logData = await logRes.json();
                renderActivityLogs(logData.events || []);
            }

            const recRes = await fetch('/api/recordings');
            if (recRes.ok) {
                const recData = await recRes.json();
                renderRecordingsList(recData.recordings || []);
            }
        } catch (err) {
            console.error("Error fetching surveillance data:", err);
        }
    }

    function renderActivityLogs(events) {
        const activityList = document.getElementById('activityList');
        if (!activityList) return;

        if (events.length === 0) {
            activityList.innerHTML = `
                <div class="activity-item">
                    <span class="time-badge">Live</span>
                    <span class="activity-msg">Monitoring classroom... No recent movement logged.</span>
                </div>
            `;
            return;
        }

        activityList.innerHTML = events.map(ev => {
            const icon = ev.level === 'success' ? 'fa-circle-check text-success' : (ev.level === 'warning' ? 'fa-triangle-exclamation text-warning' : 'fa-info-circle text-info');
            return `
                <div class="activity-item">
                    <span class="time-badge">${escapeHtml(ev.time)}</span>
                    <span class="activity-msg"><i class="fa-solid ${icon}"></i> ${escapeHtml(ev.message)}</span>
                </div>
            `;
        }).join('');
    }

    function renderRecordingsList(recordings) {
        const recordingsList = document.getElementById('recordingsList');
        if (!recordingsList) return;

        if (recordings.length === 0) {
            recordingsList.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-film"></i>
                    <p>No active video recordings saved yet.<br><small class="text-muted">Videos automatically recorded and purged after 24 hours.</small></p>
                </div>
            `;
            return;
        }

        recordingsList.innerHTML = recordings.map(rec => {
            return `
                <div class="recording-card">
                    <div class="rec-info">
                        <h5><i class="fa-solid fa-file-video text-primary"></i> ${escapeHtml(rec.filename)}</h5>
                        <p><i class="fa-regular fa-clock"></i> Recorded: ${escapeHtml(rec.created_at)} • Size: ${rec.size_mb} MB • Age: ${rec.age_hours} hrs</p>
                    </div>
                    <a href="/recordings/${encodeURIComponent(rec.filename)}" target="_blank" class="btn btn-outline btn-sm">
                        <i class="fa-solid fa-play"></i> Watch Clip
                    </a>
                </div>
            `;
        }).join('');
    }

    // 7. Reload & Export Buttons
    document.querySelectorAll('.btnRefreshFeed').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.video-feed-img').forEach(img => {
                img.src = '/video_feed?' + new Date().getTime();
            });
            showToast('Camera feed reloaded', 'success');
        });
    });

    document.querySelectorAll('.btnExportExcel').forEach(btn => {
        btn.addEventListener('click', () => {
            const monthSelect = document.getElementById('excelMonthSelect');
            const selectedVal = monthSelect ? monthSelect.value : 'current';
            
            let url = '/api/export_excel';
            if (selectedVal === 'current') {
                const now = new Date();
                const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                url += `?month=${yearMonth}`;
            } else if (selectedVal && selectedVal !== 'all') {
                url += `?month=${selectedVal}`;
            }

            window.location.href = url;
            showToast('Downloading Accurate Monthly Excel Report (.xlsx)...', 'success');
        });
    });

    document.querySelectorAll('.btnExportCSV').forEach(btn => {
        btn.addEventListener('click', () => {
            window.location.href = '/api/export_csv';
        });
    });

    // 8. Modals System
    function toggleModal(modal, show) {
        if (show) modal.classList.add('active');
        else modal.classList.remove('active');
    }

    if (openManualModalBtn) {
        openManualModalBtn.addEventListener('click', () => {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');

            const manualDateEl = document.getElementById('manualDate');
            if (manualDateEl) manualDateEl.value = `${year}-${month}-${day}`;

            document.getElementById('manualTime').value = `${hours}:${minutes}`;
            renderStudentCheckboxes();
            toggleModal(manualModal, true);
        });
    }

    if (closeManualModalBtn) closeManualModalBtn.addEventListener('click', () => toggleModal(manualModal, false));
    if (cancelManualBtn) cancelManualBtn.addEventListener('click', () => toggleModal(manualModal, false));

    // --- 9. Class Roster & Student Template Controller ---
    const rosterModal = document.getElementById('rosterModal');
    const openRosterModalBtn = document.getElementById('openRosterModalBtn');
    const closeRosterModalBtn = document.getElementById('closeRosterModalBtn');
    const cancelRosterBtn = document.getElementById('cancelRosterBtn');
    const btnAddRosterStudent = document.getElementById('btnAddRosterStudent');
    const btnBulkAddRoster = document.getElementById('btnBulkAddRoster');

    async function fetchRosterData() {
        const container = document.getElementById('rosterStudentsList');
        const badge = document.getElementById('rosterCountBadge');
        if (!container) return;

        try {
            const res = await fetch('/api/roster');
            if (!res.ok) return;
            const data = await res.json();
            const roster = data.roster || [];

            if (badge) badge.textContent = `${roster.length} Students`;

            if (roster.length === 0) {
                container.innerHTML = `<span class="text-muted small">No students in class roster template yet. Add student or bulk import template above!</span>`;
                return;
            }

            container.innerHTML = roster.map(item => {
                const sName = typeof item === 'object' ? item.name : item;
                const rNo = (typeof item === 'object' && item.roll_no && item.roll_no !== '-') ? item.roll_no : '-';
                const hasPhoto = typeof item === 'object' && item.photo;
                const photoBadge = hasPhoto 
                    ? `<span class="badge badge-ontime" style="font-size: 11px;"><i class="fa-solid fa-camera text-success"></i> Photo Saved</span>`
                    : `<span class="badge badge-late" style="font-size: 11px; opacity: 0.7;"><i class="fa-solid fa-file-lines"></i> Roster Only</span>`;

                return `
                    <div class="student-manage-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-color); border-radius: 8px;">
                        <div style="display: flex; flex-direction: column; gap: 3px;">
                            <div style="font-weight: 700; color: var(--text-main); font-size: 14px; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-user text-primary"></i> ${escapeHtml(sName)}
                            </div>
                            <div style="font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 10px;">
                                <span><i class="fa-solid fa-id-card"></i> Roll No: <strong>${escapeHtml(rNo)}</strong></span>
                                ${photoBadge}
                            </div>
                        </div>
                        <button type="button" class="btn btn-danger btn-xs btnTotalRemoveStudent" data-name="${escapeHtml(sName)}" title="Total Delete: Remove student, reference photo, and all attendance logs from class">
                            <i class="fa-solid fa-user-xmark"></i> REMOVE STUDENT
                        </button>
                    </div>
                `;
            }).join('');

            // Attach Remove Student Event Handler (Total Delete)
            container.querySelectorAll('.btnTotalRemoveStudent').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const name = e.currentTarget.getAttribute('data-name');
                    if (!name) return;

                    if (!confirm(`Warning: This will COMPLETELY DELETE student "${name}", remove their reference face photo, and wipe all attendance history from this class. Continue?`)) {
                        return;
                    }

                    try {
                        const delRes = await fetch('/api/delete_student', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name })
                        });
                        const delData = await delRes.json();
                        if (delRes.ok && delData.success) {
                            showToast(delData.message, 'success');
                            fetchRosterData();
                            fetchAttendanceData();
                        } else {
                            showToast(delData.message || 'Failed to remove student', 'danger');
                        }
                    } catch (err) {
                        showToast('Error connecting to server to remove student', 'danger');
                    }
                });
            });
        } catch (err) {
            console.error("Error fetching roster:", err);
        }
    }

    if (openRosterModalBtn) {
        openRosterModalBtn.addEventListener('click', () => {
            fetchRosterData();
            toggleModal(rosterModal, true);
        });
    }

    if (closeRosterModalBtn) closeRosterModalBtn.addEventListener('click', () => toggleModal(rosterModal, false));
    if (cancelRosterBtn) cancelRosterBtn.addEventListener('click', () => toggleModal(rosterModal, false));

    if (btnAddRosterStudent) {
        btnAddRosterStudent.addEventListener('click', async () => {
            const nameInput = document.getElementById('rosterStudentName');
            const rollInput = document.getElementById('rosterStudentRollNo');
            const name = nameInput ? nameInput.value.trim() : '';
            const roll_no = rollInput ? rollInput.value.trim() : '';

            if (!name) {
                showToast('Please enter student name!', 'danger');
                return;
            }

            try {
                const res = await fetch('/api/roster/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, roll_no })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    showToast(data.message, 'success');
                    if (nameInput) nameInput.value = '';
                    if (rollInput) rollInput.value = '';
                    fetchRosterData();
                    fetchAttendanceData();
                } else {
                    showToast(data.message || 'Error adding student', 'danger');
                }
            } catch (err) {
                showToast('Error adding student to roster', 'danger');
            }
        });
    }

    if (btnBulkAddRoster) {
        btnBulkAddRoster.addEventListener('click', async () => {
            const textEl = document.getElementById('bulkRosterText');
            const names_text = textEl ? textEl.value.trim() : '';

            if (!names_text) {
                showToast('Please paste or type student names line by line!', 'danger');
                return;
            }

            try {
                const res = await fetch('/api/roster/bulk_add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ names_text })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    showToast(data.message, 'success');
                    if (textEl) textEl.value = '';
                    fetchRosterData();
                    fetchAttendanceData();
                } else {
                    showToast(data.message || 'Error bulk importing roster', 'danger');
                }
            } catch (err) {
                showToast('Error bulk importing roster', 'danger');
            }
        });
    }

    // Submit Manual Entry & OD Form
    if (manualEntryForm) {
        manualEntryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const checkedBoxes = document.querySelectorAll('.student-checkbox:checked');
            const checkedNames = Array.from(checkedBoxes).map(cb => cb.value);
            const customName = document.getElementById('manualName').value.trim();
            const date = document.getElementById('manualDate') ? document.getElementById('manualDate').value : '';
            const time = document.getElementById('manualTime').value;
            const status = document.getElementById('manualStatus').value;
            const remarks = document.getElementById('manualRemarks') ? document.getElementById('manualRemarks').value.trim() : '';

            if (customName && !checkedNames.includes(customName)) {
                checkedNames.push(customName);
            }

            if (checkedNames.length === 0) {
                showToast('Please tick at least one student checkbox or enter a custom name!', 'danger');
                return;
            }

            if (!time) {
                showToast('Please select Time In!', 'danger');
                return;
            }

            try {
                const res = await fetch('/api/manual_entry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ names: checkedNames, date, time, status, remarks })
                });

                const result = await res.json();
                if (res.ok && result.success) {
                    showToast(result.message || 'Manual & OD entry recorded successfully!', 'success');
                    toggleModal(manualModal, false);
                    manualEntryForm.reset();
                    fetchAttendanceData();
                } else {
                    showToast(result.message || 'Error adding manual entry', 'danger');
                }
            } catch (err) {
                showToast('Failed to submit manual entry', 'danger');
            }
        });
    }

    // Submit Face Registration
    if (registerFaceForm) {
        registerFaceForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('registerName').value.trim();
            const rollNo = document.getElementById('registerRollNo') ? document.getElementById('registerRollNo').value.trim() : '';
            const fileInput = document.getElementById('faceImage');

            if (!name) {
                showToast('Please enter student full name!', 'danger');
                return;
            }

            const formData = new FormData();
            formData.append('name', name);
            formData.append('roll_no', rollNo);
            if (fileInput && fileInput.files.length > 0) {
                formData.append('file', fileInput.files[0]);
            }

            try {
                const res = await fetch('/api/register_face', {
                    method: 'POST',
                    body: formData
                });

                const result = await res.json();
                if (res.ok && result.success) {
                    showToast(result.message || 'Face registered successfully!', 'success');
                    registerFaceForm.reset();
                    fetchRosterData();
                    fetchAttendanceData();
                } else {
                    showToast(result.message || 'Failed to register face photo.', 'danger');
                }
            } catch (err) {
                showToast('Error uploading face registration.', 'danger');
            }
        });
    }

    // Clear Log
    if (btnClearLog) {
        btnClearLog.addEventListener('click', async () => {
            if (!confirm("Are you sure you want to clear today's attendance log?")) return;
            try {
                const res = await fetch('/api/clear_attendance', { method: 'POST' });
                const result = await res.json();
                if (res.ok && result.success) {
                    showToast(result.message, 'success');
                    fetchAttendanceData();
                }
            } catch (err) {
                showToast('Failed to clear log', 'danger');
            }
        });
    }

    // Toast Helper Function
    function showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icon = type === 'success' ? 'fa-circle-check text-success' : 'fa-triangle-exclamation text-danger';
        toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, match => {
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return map[match];
        });
    }

    // --- 10. Stat Category Click Controller ---
    const statDetailModal = document.getElementById('statDetailModal');
    const closeStatDetailModalBtn = document.getElementById('closeStatDetailModalBtn');
    const cancelStatDetailBtn = document.getElementById('cancelStatDetailBtn');
    const statDetailSearchInput = document.getElementById('statDetailSearchInput');
    let currentCategoryKey = '';

    function openCategoryModal(categoryKey) {
        currentCategoryKey = categoryKey;
        if (statDetailSearchInput) statDetailSearchInput.value = '';
        renderStatCategoryList(categoryKey);
        toggleModal(statDetailModal, true);
    }

    function renderStatCategoryList(categoryKey) {
        const container = document.getElementById('statDetailStudentListContainer');
        const titleEl = document.getElementById('statDetailModalTitle');
        if (!container) return;

        const searchText = statDetailSearchInput ? statDetailSearchInput.value.toLowerCase().trim() : '';

        let listItems = [];
        let modalTitle = '';

        if (categoryKey === 'total_present') {
            modalTitle = `<i class="fa-solid fa-users text-primary"></i> Total Present Today (${cachedAttendance.length} Students)`;
            listItems = cachedAttendance.map(item => ({
                name: item.Name,
                status: item.Status || 'On Time',
                time: item.In_Time || item.Time || '-',
                remarks: item.Remarks || '-'
            }));
        } else if (categoryKey === 'on_time') {
            const matches = cachedAttendance.filter(item => (item.Status || '').trim() === 'On Time');
            modalTitle = `<i class="fa-solid fa-circle-check text-success"></i> On Time Students Today (${matches.length} Students)`;
            listItems = matches.map(item => ({
                name: item.Name,
                status: 'On Time',
                time: item.In_Time || item.Time || '-',
                remarks: item.Remarks || '-'
            }));
        } else if (categoryKey === 'late') {
            const matches = cachedAttendance.filter(item => (item.Status || '').trim() === 'Late');
            modalTitle = `<i class="fa-solid fa-triangle-exclamation text-danger"></i> Late Arrival Students Today (${matches.length} Students)`;
            listItems = matches.map(item => ({
                name: item.Name,
                status: 'Late',
                time: item.In_Time || item.Time || '-',
                remarks: item.Remarks || '-'
            }));
        } else if (categoryKey === 'od') {
            const matches = cachedAttendance.filter(item => {
                const s = (item.Status || '').toUpperCase();
                return s.includes('OD') || s.includes('DUTY') || s.includes('PERMISSION');
            });
            modalTitle = `<i class="fa-solid fa-id-badge text-warning"></i> OD & Permission Students Today (${matches.length} Students)`;
            listItems = matches.map(item => ({
                name: item.Name,
                status: item.Status,
                time: item.In_Time || item.Time || '-',
                remarks: item.Remarks || '-'
            }));
        } else if (categoryKey === 'absent') {
            const loggedNamesLower = new Set(cachedAttendance.map(item => (item.Name || '').toLowerCase()));
            const absentStudents = cachedRegisteredStudents.filter(name => !loggedNamesLower.has(name.toLowerCase()));
            
            modalTitle = `<i class="fa-solid fa-user-xmark text-danger"></i> Total Absent Students Today (${absentStudents.length} Students)`;
            listItems = absentStudents.map(name => ({
                name: name,
                status: 'Absent',
                time: 'Not Scanned Today',
                remarks: 'No attendance logged'
            }));
        } else if (categoryKey === 'enrolled') {
            modalTitle = `<i class="fa-solid fa-graduation-cap text-info"></i> All Enrolled Class Roster (${cachedRegisteredStudents.length} Students)`;
            listItems = cachedRegisteredStudents.map(name => {
                const isPresent = cachedAttendance.some(item => (item.Name || '').toLowerCase() === name.toLowerCase());
                return {
                    name: name,
                    status: isPresent ? 'Present Today' : 'Absent Today',
                    time: isPresent ? 'Logged' : 'Not Logged',
                    remarks: 'Enrolled Class Roster'
                };
            }));
        }

        if (titleEl) titleEl.innerHTML = modalTitle;

        if (searchText) {
            listItems = listItems.filter(item => 
                item.name.toLowerCase().includes(searchText) || 
                item.status.toLowerCase().includes(searchText) ||
                item.remarks.toLowerCase().includes(searchText)
            );
        }

        if (listItems.length === 0) {
            container.innerHTML = `<div class="empty-state" style="padding: 16px;"><p>No matching students found in this category.</p></div>`;
            return;
        }

        container.innerHTML = listItems.map(item => {
            let statusBadge = `<span class="badge badge-ontime">${escapeHtml(item.status)}</span>`;
            if (item.status === 'Late') statusBadge = `<span class="badge badge-late">Late</span>`;
            else if (item.status.includes('OD') || item.status.includes('Duty')) statusBadge = `<span class="badge badge-warning">OD</span>`;
            else if (item.status === 'Absent' || item.status === 'Absent Today') statusBadge = `<span class="badge badge-danger">Absent</span>`;

            return `
                <div class="student-detail-row" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-color); border-radius: 10px;">
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <span style="font-weight: 700; color: var(--text-main); font-size: 14px;">
                            <i class="fa-solid fa-user text-primary" style="margin-right: 6px;"></i> ${escapeHtml(item.name)}
                        </span>
                        <span style="font-size: 12px; color: var(--text-muted);">
                            <i class="fa-regular fa-clock"></i> Time: <strong>${escapeHtml(item.time)}</strong> • Remarks: ${escapeHtml(item.remarks)}
                        </span>
                    </div>
                    <div>
                        ${statusBadge}
                    </div>
                </div>
            `;
        }).join('');
    }

    if (statDetailSearchInput) {
        statDetailSearchInput.addEventListener('input', () => renderStatCategoryList(currentCategoryKey));
    }

    if (closeStatDetailModalBtn) closeStatDetailModalBtn.addEventListener('click', () => toggleModal(statDetailModal, false));
    if (cancelStatDetailBtn) cancelStatDetailBtn.addEventListener('click', () => toggleModal(statDetailModal, false));

    // Attach Click Handlers to all Stat Cards
    document.querySelector('.card-total')?.addEventListener('click', () => openCategoryModal('total_present'));
    document.querySelector('.card-ontime')?.addEventListener('click', () => openCategoryModal('on_time'));
    document.querySelector('.card-late')?.addEventListener('click', () => openCategoryModal('late'));
    document.querySelector('.card-od')?.addEventListener('click', () => openCategoryModal('od'));
    document.querySelector('.card-absent')?.addEventListener('click', () => openCategoryModal('absent'));
    document.querySelector('.card-enrolled')?.addEventListener('click', () => openCategoryModal('enrolled'));

    // Check Initial Session
    checkAuthSession();
    setInterval(fetchAttendanceData, 2500);

    // 3D Card Interactive Mouse Tilt Physics System
    function init3DCardTilt() {
        document.querySelectorAll('.tilt-card').forEach(card => {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                const centerX = rect.width / 2;
                const centerY = rect.height / 2;

                const rotateX = ((y - centerY) / centerY) * -12;
                const rotateY = ((x - centerX) / centerX) * 12;

                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
            });

            card.addEventListener('mouseleave', () => {
                card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
            });
        });
    }

    // Launch 3D Tilt System
    setTimeout(() => {
        init3DCardTilt();
    }, 200);
});

