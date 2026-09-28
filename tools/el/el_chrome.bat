@echo off
REM Visible ElevenLabs Chrome (existing signed-in profile) for v3 voice generation. Not used for WebGPU.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\chrome_automation\elevenlabs_sfx" --remote-debugging-port=9201 --remote-allow-origins=* --disable-backgrounding-occluded-windows --disable-background-timer-throttling --disable-renderer-backgrounding https://elevenlabs.io/app/speech-synthesis/text-to-speech
