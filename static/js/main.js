document.addEventListener('DOMContentLoaded', () => {
    // Theme Selector Logic
    const themeSelector = document.getElementById('themeSelector');
    let savedTheme = localStorage.getItem('portalTheme');
    if (!savedTheme || savedTheme === 'sapphire') {
        savedTheme = 'emerald';
        localStorage.setItem('portalTheme', 'emerald');
    }
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
    let cachedRoster = [];
    let currentClassCode = 'ECE2';

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

    // Camera Control State & Multi-Device System
    let isCameraActive = false;
    let useClientDeviceCam = true; // Default: Activate local device camera (Mobile / Laptop / Tablet)
    let clientMediaStream = null;
    let clientFrameInterval = null;
    let currentFacingMode = 'user'; // 'user' (Front) or 'environment' (Rear/Back)

    async function startCamera() {
        const serverVideoImg = document.getElementById('serverVideoImg');
        const clientVideo = document.getElementById('clientVideo');
        const camStandbyScreen = document.getElementById('camStandbyScreen');
        const camStatusMsg = document.getElementById('camStatusMsg');
        const btnToggleCamera = document.getElementById('btnToggleCamera');
        const btnFlipCam = document.getElementById('btnFlipCam');
        const btnToggleCamSource = document.getElementById('btnToggleCamSource');
        const videoOverlayHUD = document.getElementById('videoOverlayHUD');

        isCameraActive = true;
        if (camStandbyScreen) camStandbyScreen.style.display = 'none';
        if (videoOverlayHUD) videoOverlayHUD.style.display = 'block';

        if (btnToggleCamera) {
            btnToggleCamera.className = 'btn btn-danger btn-sm';
            btnToggleCamera.innerHTML = `<i class="fa-solid fa-power-off"></i> Turn Camera OFF`;
        }

        // Try local device camera first (Mobile / Tablet / Laptop / Desktop webcam)
        if (useClientDeviceCam && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                if (clientMediaStream) {
                    clientMediaStream.getTracks().forEach(track => track.stop());
                }

                if (serverVideoImg) {
                    serverVideoImg.style.display = 'none';
                    serverVideoImg.src = '';
                    serverVideoImg.removeAttribute('src');
                }

                const constraints = {
                    video: {
                        facingMode: currentFacingMode,
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    }
                };

                clientMediaStream = await navigator.mediaDevices.getUserMedia(constraints);
                if (clientVideo) {
                    clientVideo.srcObject = clientMediaStream;
                    clientVideo.style.display = 'block';
                    const clientCanvas = document.getElementById('clientCanvas');
                    if (clientCanvas) clientCanvas.style.display = 'block';
                    await clientVideo.play();
                }

                if (btnFlipCam) btnFlipCam.style.display = 'inline-flex';
                if (btnToggleCamSource) btnToggleCamSource.innerHTML = `<i class="fa-solid fa-desktop"></i> Switch to Host PC Feed`;

                if (camStatusMsg) {
                    camStatusMsg.innerHTML = `<i class="fa-solid fa-camera text-success"></i> ${currentFacingMode === 'user' ? 'Front' : 'Rear'} Device Camera Active`;
                }

                startClientFrameProcessor();
                return;
            } catch (err) {
                console.warn("[INFO] Client device camera permission denied or unavailable, falling back to server feed:", err);
                useClientDeviceCam = false;
            }
        }

        // Fallback: Server Local Feed
        if (clientVideo) {
            clientVideo.style.display = 'none';
            if (clientVideo.srcObject) {
                clientVideo.srcObject.getTracks().forEach(track => track.stop());
                clientVideo.srcObject = null;
            }
        }
        stopClientFrameProcessor();

        if (btnFlipCam) btnFlipCam.style.display = 'none';
        if (btnToggleCamSource) btnToggleCamSource.innerHTML = `<i class="fa-solid fa-mobile-screen"></i> Use Device Camera`;

        if (serverVideoImg) {
            serverVideoImg.style.display = 'block';
            serverVideoImg.src = '/video_feed?' + new Date().getTime();
        }

        if (camStatusMsg) {
            camStatusMsg.innerHTML = `<i class="fa-solid fa-shield-halved text-success"></i> Server Feed Active`;
        }
    }

    function stopCamera() {
        const serverVideoImg = document.getElementById('serverVideoImg');
        const clientVideo = document.getElementById('clientVideo');
        const camStandbyScreen = document.getElementById('camStandbyScreen');
        const camStatusMsg = document.getElementById('camStatusMsg');
        const btnToggleCamera = document.getElementById('btnToggleCamera');
        const videoOverlayHUD = document.getElementById('videoOverlayHUD');

        isCameraActive = false;
        stopClientFrameProcessor();

        if (clientMediaStream) {
            clientMediaStream.getTracks().forEach(track => track.stop());
            clientMediaStream = null;
        }

        if (clientVideo) {
            clientVideo.style.display = 'none';
            clientVideo.srcObject = null;
        }
        const clientCanvas = document.getElementById('clientCanvas');
        if (clientCanvas) clientCanvas.style.display = 'none';

        if (serverVideoImg) {
            serverVideoImg.style.display = 'none';
            serverVideoImg.src = '';
            serverVideoImg.removeAttribute('src');
        }

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

    let isClientFrameProcessing = false;
    let _lastAttendanceFetchTime = 0;
    let _consecutiveErrors = 0;
    let clientFrameTimer = null;
    const FRAME_THROTTLE_MS = 250; // Throttle to ~4 FPS to avoid network & server overload

    function startClientFrameProcessor() {
        stopClientFrameProcessor();
        const clientVideo = document.getElementById('clientVideo');
        const clientCanvas = document.getElementById('clientCanvas');
        if (!clientVideo || !clientCanvas) return;

        const ctx = clientCanvas.getContext('2d');

        async function processFrameLoop() {
            if (!isCameraActive || !useClientDeviceCam || clientVideo.paused || clientVideo.ended) {
                stopClientFrameProcessor();
                return;
            }

            // Gated Lock: Only send frame if previous frame request has completed
            if (!isClientFrameProcessing && clientVideo.videoWidth > 0 && clientVideo.videoHeight > 0) {
                isClientFrameProcessing = true;
                clientCanvas.width = 480;
                clientCanvas.height = 360;
                ctx.drawImage(clientVideo, 0, 0, 480, 360);

                const dataUrl = clientCanvas.toDataURL('image/jpeg', 0.55);

                try {
                    const res = await fetch('/api/process_client_frame', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ image: dataUrl })
                    });
                    const data = await res.json();
                    _consecutiveErrors = 0;
                    const faceList = data.detected_faces || data.faces || [];

                    // Redraw the video frame fresh before drawing overlays
                    ctx.drawImage(clientVideo, 0, 0, 480, 360);

                    if (data.success && faceList.length > 0) {
                        faceList.forEach(f => {
                            const [bx, by, bw, bh] = f.box || [f.left, f.top, f.right - f.left, f.bottom - f.top];
                            const isMatch = f.is_match || (f.name && !f.name.includes('Unknown') && !f.name.includes('Scanning') && !f.name.includes('Detected'));

                            // Colors: Green=MATCH, Yellow=FACE DETECTED (Unregistered)
                            const boxColor    = isMatch ? '#10B981' : '#FACC15';
                            const cornerColor = isMatch ? '#34D399' : '#FDE68A';
                            const badgeBg     = isMatch ? 'rgba(16, 185, 129, 0.95)' : 'rgba(234, 179, 8, 0.92)';

                            // Draw border
                            ctx.strokeStyle = boxColor;
                            ctx.lineWidth = 2;
                            ctx.strokeRect(bx, by, bw, bh);

                            // Draw corner reticle
                            const cornerLen = Math.min(bw, bh) * 0.22;
                            ctx.strokeStyle = cornerColor;
                            ctx.lineWidth = 4;

                            // Top-Left
                            ctx.beginPath(); ctx.moveTo(bx, by + cornerLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerLen, by); ctx.stroke();
                            // Top-Right
                            ctx.beginPath(); ctx.moveTo(bx + bw - cornerLen, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cornerLen); ctx.stroke();
                            // Bottom-Left
                            ctx.beginPath(); ctx.moveTo(bx, by + bh - cornerLen); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cornerLen, by + bh); ctx.stroke();
                            // Bottom-Right
                            ctx.beginPath(); ctx.moveTo(bx + bw - cornerLen, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cornerLen); ctx.stroke();

                            // Label Badge
                            ctx.font = '700 12px Inter, sans-serif';
                            const pctText = (isMatch && f.confidence_pct) ? ` (${f.confidence_pct}%)` : '';
                            const labelText = isMatch ? `✔ MATCH: ${f.name}${pctText}` : `⚠ FACE DETECTED — Not Registered`;
                            const labelWidth = Math.max(180, ctx.measureText(labelText).width + 20);
                            ctx.fillStyle = badgeBg;
                            ctx.fillRect(bx, Math.max(0, by - 26), labelWidth, 24);
                            ctx.fillStyle = '#FFFFFF';
                            ctx.fillText(labelText, bx + 8, Math.max(16, by - 9));

                            // Debounced attendance fetch — max once every 5 seconds
                            if (isMatch) {
                                const now = Date.now();
                                if (now - _lastAttendanceFetchTime > 5000) {
                                    _lastAttendanceFetchTime = now;
                                    fetchAttendanceData();
                                }
                            }
                        });
                    } else if (data.success && faceList.length === 0) {
                        ctx.font = '600 13px Inter, sans-serif';
                        ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
                        ctx.fillText('🔍 Scanning for Face...', 12, 24);
                    }
                } catch (err) {
                    _consecutiveErrors++;
                    console.error("Client frame post error:", err);
                } finally {
                    isClientFrameProcessing = false;
                }
            }

            if (isCameraActive && useClientDeviceCam) {
                clientFrameTimer = setTimeout(processFrameLoop, FRAME_THROTTLE_MS);
            }
        }

        processFrameLoop();
    }

    function stopClientFrameProcessor() {
        if (clientFrameTimer) {
            clearTimeout(clientFrameTimer);
            clientFrameTimer = null;
        }
        if (typeof clientFrameInterval !== 'undefined' && clientFrameInterval) {
            clearInterval(clientFrameInterval);
            clientFrameInterval = null;
        }
        isClientFrameProcessing = false;
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

    const btnFlipCam = document.getElementById('btnFlipCam');
    if (btnFlipCam) {
        btnFlipCam.addEventListener('click', () => {
            currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
            showToast(`Switched to ${currentFacingMode === 'user' ? 'Front Selfie' : 'Rear Main'} Camera`, 'info');
            if (isCameraActive) startCamera();
        });
    }

    const btnToggleCamSource = document.getElementById('btnToggleCamSource');
    if (btnToggleCamSource) {
        btnToggleCamSource.addEventListener('click', () => {
            useClientDeviceCam = !useClientDeviceCam;
            showToast(useClientDeviceCam ? 'Switched to Local Device Camera' : 'Switched to Host PC Feed', 'info');
            if (isCameraActive) startCamera();
        });
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

        // Prompt Computer Storage Location Modal right after login if not already shown
        if (!localStorage.getItem('storage_mode_prompt_shown')) {
            setTimeout(() => {
                openStorageModal();
            }, 600);
        }
    }

    // --- Computer Internal Storage Location Manager ---
    const storageModal = document.getElementById('storageModal');
    const btnOpenStorageModal = document.getElementById('btnOpenStorageModal');
    const closeStorageModalBtn = document.getElementById('closeStorageModalBtn');
    const cancelStorageBtn = document.getElementById('cancelStorageBtn');
    const btnChooseDiskStorage = document.getElementById('btnChooseDiskStorage');
    const btnChooseWebsiteOnly = document.getElementById('btnChooseWebsiteOnly');
    const cardSelectDiskStorage = document.getElementById('cardSelectDiskStorage');
    const cardSelectWebsiteOnly = document.getElementById('cardSelectWebsiteOnly');

    const headerStorageIcon = document.getElementById('headerStorageIcon');
    const headerStorageBadgeText = document.getElementById('headerStorageBadgeText');

    function openStorageModal() {
        if (storageModal) storageModal.classList.add('active');
        highlightCurrentStorageCard();
        fetchDetectedDrives();
    }

    async function fetchDetectedDrives() {
        try {
            const res = await fetch('/api/detect_drives');
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.drives && data.drives.length > 0) {
                    const container = document.getElementById('pcDriveChips');
                    if (container) {
                        const savedPath = localStorage.getItem('custom_storage_path') || data.active_path || 'attendance_data';
                        container.innerHTML = data.drives.map(d => {
                            const isSelected = savedPath.toUpperCase().startsWith(d.drive.toUpperCase());
                            const chipClass = isSelected ? 'chip-btn drive-chip active' : 'chip-btn drive-chip';
                            return `<button type="button" class="${chipClass}" data-path="${d.suggested_path}"><i class="fa-solid fa-hard-drive text-warning"></i> ${d.name}</button>`;
                        }).join('');

                        attachDriveChipHandlers();
                    }
                }
            }
        } catch (err) {
            console.warn("Drive detection fetch info:", err);
        }
    }

    function attachDriveChipHandlers() {
        document.querySelectorAll('.drive-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const path = chip.getAttribute('data-path');
                const customPathInput = document.getElementById('customFolderPathInput');
                if (customPathInput && path) {
                    customPathInput.value = path;
                    document.querySelectorAll('.drive-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    setStoragePreference('internal_disk', true);
                }
            });
        });
    }

    function closeStorageModal() {
        if (storageModal) storageModal.classList.remove('active');
    }

    function highlightCurrentStorageCard() {
        const savedMode = localStorage.getItem('storage_mode') || 'internal_disk';
        if (cardSelectDiskStorage && cardSelectWebsiteOnly) {
            if (savedMode === 'internal_disk') {
                cardSelectDiskStorage.style.borderColor = 'var(--primary)';
                cardSelectDiskStorage.style.background = 'rgba(30, 41, 59, 0.85)';
                cardSelectWebsiteOnly.style.borderColor = 'var(--border-color)';
                cardSelectWebsiteOnly.style.background = 'rgba(30, 41, 59, 0.4)';
            } else {
                cardSelectWebsiteOnly.style.borderColor = 'var(--info)';
                cardSelectWebsiteOnly.style.background = 'rgba(30, 41, 59, 0.85)';
                cardSelectDiskStorage.style.borderColor = 'var(--border-color)';
                cardSelectDiskStorage.style.background = 'rgba(30, 41, 59, 0.4)';
            }
        }
    }

    async function setStoragePreference(mode, isExplicit = true) {
        localStorage.setItem('storage_mode', mode);
        localStorage.setItem('storage_mode_prompt_shown', 'true');
        highlightCurrentStorageCard();

        const customPathInput = document.getElementById('customFolderPathInput');
        const custom_path = customPathInput ? customPathInput.value.trim() : 'attendance_data';
        if (custom_path) {
            localStorage.setItem('custom_storage_path', custom_path);
        }

        try {
            const res = await fetch('/api/storage_mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storage_mode: mode, custom_path: custom_path })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                updateStorageBadgeUI(mode, data.custom_path || custom_path);
                if (isExplicit) {
                    if (mode === 'internal_disk') {
                        showToast(`💾 Storage Permission Granted! All files saved to '${data.custom_path || custom_path}'`, 'success');
                    } else {
                        showToast('🌐 Website Only Mode Enabled! No files created on computer internal storage.', 'info');
                    }
                    closeStorageModal();
                }
            }
        } catch (err) {
            console.error("Storage mode setting error:", err);
        }
    }

    function updateStorageBadgeUI(mode, path = 'attendance_data') {
        if (headerStorageBadgeText) {
            if (mode === 'internal_disk') {
                headerStorageBadgeText.textContent = `PC Storage: ${path}`;
                if (headerStorageIcon) headerStorageIcon.className = 'fa-solid fa-hard-drive text-warning';
            } else {
                headerStorageBadgeText.textContent = 'Website Only (No Files)';
                if (headerStorageIcon) headerStorageIcon.className = 'fa-solid fa-cloud text-info';
            }
        }
    }

    const driveSelectDropdown = document.getElementById('driveSelectDropdown');
    const btnBrowseFolder = document.getElementById('btnBrowseFolder');
    const folderPickerInput = document.getElementById('folderPickerInput');

    if (driveSelectDropdown) {
        driveSelectDropdown.addEventListener('change', (e) => {
            const selectedVal = e.target.value;
            const customPathInput = document.getElementById('customFolderPathInput');
            if (selectedVal !== 'custom' && customPathInput) {
                customPathInput.value = selectedVal;
                setStoragePreference('internal_disk', true);
            } else if (customPathInput) {
                customPathInput.focus();
            }
        });
    }

    if (btnBrowseFolder && folderPickerInput) {
        btnBrowseFolder.addEventListener('click', () => {
            folderPickerInput.click();
        });

        folderPickerInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const relativePath = e.target.files[0].webkitRelativePath || '';
                const folderName = relativePath.split('/')[0] || 'Attendance_Data';
                const customPathInput = document.getElementById('customFolderPathInput');
                if (customPathInput) {
                    customPathInput.value = `D:/${folderName}`;
                    setStoragePreference('internal_disk', true);
                }
            }
        });
    }

    const btnApplyCustomFolder = document.getElementById('btnApplyCustomFolder');
    if (btnApplyCustomFolder) {
        btnApplyCustomFolder.addEventListener('click', () => {
            setStoragePreference('internal_disk', true);
        });
    }

    attachDriveChipHandlers();

    if (btnOpenStorageModal) btnOpenStorageModal.addEventListener('click', openStorageModal);
    if (closeStorageModalBtn) closeStorageModalBtn.addEventListener('click', closeStorageModal);
    if (cancelStorageBtn) cancelStorageBtn.addEventListener('click', closeStorageModal);

    if (btnChooseDiskStorage) btnChooseDiskStorage.addEventListener('click', () => setStoragePreference('internal_disk'));
    if (btnChooseWebsiteOnly) btnChooseWebsiteOnly.addEventListener('click', () => setStoragePreference('website_only'));
    if (cardSelectDiskStorage) cardSelectDiskStorage.addEventListener('click', (e) => {
        if (e.target.id !== 'btnChooseDiskStorage') setStoragePreference('internal_disk');
    });
    if (cardSelectWebsiteOnly) cardSelectWebsiteOnly.addEventListener('click', (e) => {
        if (e.target.id !== 'btnChooseWebsiteOnly') setStoragePreference('website_only');
    });

    // Sync saved storage mode on app init
    const initialStorageMode = localStorage.getItem('storage_mode') || 'internal_disk';
    setStoragePreference(initialStorageMode, false);



    // Registration Modal System
    const regModal = document.getElementById('regModal');
    const btnOpenRegModal = document.getElementById('btnOpenRegModal');
    const closeRegModalBtn = document.getElementById('closeRegModalBtn');
    const cancelRegModalBtn = document.getElementById('cancelRegModalBtn');
    const regModalForm = document.getElementById('regModalForm');

    function toggleRegModal(show) {
        if (regModal) {
            if (show) regModal.classList.add('active');
            else regModal.classList.remove('active');
        }
    }

    if (btnOpenRegModal) btnOpenRegModal.addEventListener('click', () => toggleRegModal(true));
    if (closeRegModalBtn) closeRegModalBtn.addEventListener('click', () => toggleRegModal(false));
    if (cancelRegModalBtn) cancelRegModalBtn.addEventListener('click', () => toggleRegModal(false));


    if (regModalForm) {
        regModalForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const regId = document.getElementById('regModalId')?.value.trim() || '';
            const regName = document.getElementById('regModalName')?.value.trim() || '';
            const regPass = document.getElementById('regModalPass')?.value.trim() || '';
            const regError = document.getElementById('regModalErrorMsg');

            if (!regId || !regPass) {
                if (regError) {
                    regError.textContent = '❌ Please enter Login ID and Password!';
                    regError.style.display = 'block';
                }
                return;
            }

            try {
                const res = await fetch('/api/register_account', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login_id: regId, class_name: regName, password: regPass })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    showToast(data.message || 'Account created successfully!', 'success');
                    if (loginIdInput) loginIdInput.value = regId;
                    if (loginPassInput) loginPassInput.value = regPass;
                    toggleRegModal(false);
                } else {
                    if (regError) {
                        regError.textContent = data.message || 'Registration failed!';
                        regError.style.display = 'block';
                    }
                }
            } catch (err) {
                showToast('Error creating account', 'danger');
            }
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
    let failedLoginAttempts = 0;

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
                loginErrorMsg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Too many failed attempts!</strong><br><small style="color: var(--danger);">Security Lock Active: Please wait <strong>${cooldownSecondsLeft} seconds</strong> before trying again.</small>`;
                loginErrorMsg.style.display = 'block';
            }

            if (cooldownSecondsLeft <= 0) {
                clearInterval(loginCooldownTimer);
                loginCooldownTimer = null;
                failedLoginAttempts = 0;
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
                    failedLoginAttempts = 0;
                    if (loginIdInput) loginIdInput.classList.remove('input-error');
                    if (loginPassInput) loginPassInput.classList.remove('input-error');
                    if (loginErrorMsg) loginErrorMsg.style.display = 'none';
                    showToast(data.message || 'Login Successful!', 'success');
                    showDashboard(data.class_name);
                } else {
                    failedLoginAttempts++;
                    if (failedLoginAttempts >= 2) {
                        triggerLoginError('Too many failed attempts! Security lock active.', 'password');
                        showToast('Too many failed attempts! 60s cooldown initiated.', 'danger');
                        startLoginCooldown(60);
                    } else {
                        triggerLoginError('Your ID and password are wrong.', data.error_type || 'password');
                        showToast('Your ID and password are wrong.', 'danger');
                    }
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
            cachedRoster = data.roster || [];
            currentClassCode = data.class_code || 'ECE2';
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
                const statStrength = document.getElementById('statStrength');
                if (statStrength) statStrength.textContent = data.stats.total_strength || data.stats.enrolled || (cachedRoster.length || 60);
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

    // Function to render registered students list with face photos & Delete buttons inside Modal 2
    function renderRegisteredStudentsManageList() {
        const container = document.getElementById('registeredStudentsManageList');
        const badge = document.getElementById('registeredStudentsCountBadge');
        if (!container) return;

        // Update Total Strength & Enrolled count
        const statStrengthEl = document.getElementById('statStrength');
        const countVal = cachedRegisteredStudents.length || cachedRoster.length || 0;
        if (statStrengthEl) statStrengthEl.textContent = countVal;

        if (badge) {
            badge.textContent = `${cachedRegisteredStudents.length} Enrolled`;
        }

        if (cachedRegisteredStudents.length === 0) {
            container.innerHTML = `<span class="text-muted small">No registered students found. Upload a face photo above to train.</span>`;
            return;
        }

        // Sort students in Alphabetical Order (A to Z)
        const sortedStudents = [...cachedRegisteredStudents].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        container.innerHTML = sortedStudents.map(studentName => {
            const rosterItem = cachedRoster.find(r => (typeof r === 'object' && r.name ? r.name.toLowerCase() : String(r).toLowerCase()) === studentName.toLowerCase());
            const photoName = (rosterItem && typeof rosterItem === 'object') ? rosterItem.photo : null;
            const rollNo = (rosterItem && typeof rosterItem === 'object' && rosterItem.roll_no && rosterItem.roll_no !== '-') ? rosterItem.roll_no : '';

            const avatarHtml = photoName ? 
                `<img src="/api/student_photo/${encodeURIComponent(currentClassCode)}/${encodeURIComponent(photoName)}" alt="${escapeHtml(studentName)}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--primary);" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';">
                 <i class="fa-solid fa-circle-user text-primary" style="font-size: 24px; display: none; margin-right: 6px;"></i>` :
                `<i class="fa-solid fa-circle-user text-primary" style="font-size: 24px; margin-right: 6px;"></i>`;

            const rollText = rollNo ? `<span style="font-size: 11px; color: var(--text-muted); margin-left: 6px;">(Roll: ${escapeHtml(rollNo)})</span>` : '';

            return `
                <div class="student-manage-item" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ${avatarHtml}
                        <span style="font-weight: 600; color: var(--text-main); font-size: 13px;">${escapeHtml(studentName)} ${rollText}</span>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <button type="button" class="btn btn-secondary btn-xs btnUpdateStudentPhoto" data-name="${escapeHtml(studentName)}" data-roll="${escapeHtml(rollNo)}" title="Upload a new reference face photo for ${escapeHtml(studentName)}">
                            <i class="fa-solid fa-camera-rotate"></i> Update Photo
                        </button>
                        <button type="button" class="btn btn-danger btn-xs btnDeleteStudent" data-name="${escapeHtml(studentName)}" title="Delete student and remove face recognition model">
                            <i class="fa-solid fa-trash-can"></i> Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');


        // Attach Update Photo Click Handler
        container.querySelectorAll('.btnUpdateStudentPhoto').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                const roll = e.currentTarget.getAttribute('data-roll') || '';
                const nameInput = document.getElementById('registerName');
                const rollInput = document.getElementById('registerRollNo');
                const photoInput = document.getElementById('faceImage');

                if (nameInput) nameInput.value = name;
                if (rollInput) rollInput.value = roll;
                if (photoInput) {
                    photoInput.focus();
                    photoInput.click();
                }
                showToast(`Ready to update photo for "${name}". Select a new face photo and click Save!`, 'info');
            });
        });

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

    const btnClearAllAttendance = document.getElementById('btnClearAllAttendance');
    if (btnClearAllAttendance) {
        btnClearAllAttendance.addEventListener('click', async () => {
            if (!confirm("Are you sure you want to CLEAR ALL attendance logs and present data for this class?")) {
                return;
            }

            try {
                const res = await fetch('/api/clear_all_attendance', { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.success) {
                    showToast(data.message || "Cleared all attendance logs!", 'success');
                    fetchAttendanceData();
                } else {
                    showToast(data.message || "Failed to clear attendance.", 'danger');
                }
            } catch (err) {
                showToast("Error clearing attendance records.", 'danger');
            }
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
                    await fetchAttendanceData();
                    renderRegisteredStudentsManageList();
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
            });
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
    document.querySelector('.card-strength')?.addEventListener('click', () => {
        const openRosterModalBtn = document.getElementById('openRosterModalBtn');
        if (openRosterModalBtn) {
            openRosterModalBtn.click();
            showToast('Showing Class Roster in Alphabetical Order (A-Z)', 'info');
        } else {
            openCategoryModal('enrolled');
        }
    });

    // Cookie Consent Banner System
    const cookieBanner = document.getElementById('cookieConsentBanner');
    const btnAcceptCookies = document.getElementById('btnAcceptCookies');

    function checkCookieConsent() {
        const isAccepted = localStorage.getItem('cookie_consent') === 'accepted' || document.cookie.includes('cookie_consent=accepted');
        if (cookieBanner) {
            if (isAccepted) {
                cookieBanner.style.display = 'none';
            } else {
                cookieBanner.style.display = 'flex';
            }
        }
    }

    if (btnAcceptCookies) {
        btnAcceptCookies.addEventListener('click', async () => {
            localStorage.setItem('cookie_consent', 'accepted');
            if (cookieBanner) cookieBanner.style.display = 'none';
            try {
                await fetch('/api/accept_cookies', { method: 'POST' });
            } catch (e) {}
            showToast('🍪 Cookie & privacy preferences saved!', 'success');
        });
    }

    // HOD A-to-Z Features Collapse Toggle
    const btnToggleHodFeatures = document.getElementById('btnToggleHodFeatures');
    const hodFeaturesCollapse = document.getElementById('hodFeaturesCollapse');
    const hodChevron = document.getElementById('hodChevron');
    if (btnToggleHodFeatures && hodFeaturesCollapse) {
        btnToggleHodFeatures.addEventListener('click', () => {
            const isHidden = hodFeaturesCollapse.style.display === 'none' || !hodFeaturesCollapse.style.display;
            hodFeaturesCollapse.style.display = isHidden ? 'block' : 'none';
            if (hodChevron) {
                hodChevron.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
            }
        });
    }

    checkCookieConsent();

    // Check Initial Session
    checkAuthSession();
    setInterval(fetchAttendanceData, 15000);  // Poll attendance every 15s (was 2.5s)
});


