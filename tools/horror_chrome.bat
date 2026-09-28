@echo off
REM Dedicated WebGPU test Chrome for the horror project (separate profile, visible window, CDP 9021)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\chrome_automation\horror_webgpu" --remote-debugging-port=9021 --remote-allow-origins=* --disable-backgrounding-occluded-windows --disable-background-timer-throttling --disable-renderer-backgrounding --autoplay-policy=no-user-gesture-required --window-size=1280,800 %1
