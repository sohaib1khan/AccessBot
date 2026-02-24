// voice.js — Phase 4 Voice Interface
// Loaded after app.js. Augments the chat with push-to-talk STT and auto-speak TTS.

(function () {
    'use strict';

    const API_URL = '/api';

    // ── State ─────────────────────────────────────────────────────────────────
    let voiceEnabled  = false;   // auto-speak AI replies
    let hasVoiceKey   = false;   // whether an OpenAI key is configured for voice
    let ttsVoice      = 'nova';
    let mediaRecorder = null;
    let audioChunks   = [];
    let isRecording   = false;
    let currentAudio  = null;    // HTMLAudioElement currently playing

    // ── DOM refs (populated after DOMContentLoaded) ───────────────────────────
    let micBtn, recordingIndicator;

    // ── Init ──────────────────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', () => {
        micBtn             = document.getElementById('mic-btn');
        recordingIndicator = document.getElementById('recording-indicator');

        const token = localStorage.getItem('authToken');
        if (token) initVoice(token);

        // Re-init when user logs in (app.js calls showChat which we can piggyback)
        // We poll authToken once per second until it appears, then init once
        if (!token) {
            const poll = setInterval(() => {
                const t = localStorage.getItem('authToken');
                if (t) { clearInterval(poll); initVoice(t); }
            }, 1000);
        }
    });

    async function initVoice(token) {
        // Load voice settings from backend
        try {
            const res = await fetch(`${API_URL}/voice/settings`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) return;
            const data = await res.json();
            voiceEnabled = data.voice_enabled;
            ttsVoice     = data.tts_voice || 'nova';
            hasVoiceKey  = data.has_voice_key;
        } catch { return; }

        // Only show the mic button if the browser supports MediaRecorder AND a voice key is set
        if (!window.MediaRecorder || !navigator.mediaDevices) return;
        if (!hasVoiceKey) return;

        micBtn.style.display = 'flex';
        setupMicButton();
        setupSpacebarPTT();

        // Patch app.js's addMessage to intercept assistant replies for auto-speak
        patchAddMessage();
    }

    // ── MediaRecorder setup ───────────────────────────────────────────────────

    function setupMicButton() {
        // Desktop: hold-to-record
        micBtn.addEventListener('mousedown',  startRecording);
        micBtn.addEventListener('mouseup',    stopRecording);
        micBtn.addEventListener('mouseleave', cancelRecordingIfActive);

        // Touch: hold-to-record
        micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); }, { passive: false });
        micBtn.addEventListener('touchend',   (e) => { e.preventDefault(); stopRecording();  }, { passive: false });
    }

    function setupSpacebarPTT() {
        // Hold space outside the textarea to record
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
                if (!isRecording) { e.preventDefault(); startRecording(); }
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && isRecording) {
                e.preventDefault();
                stopRecording();
            }
        });
    }

    async function startRecording() {
        if (isRecording) return;
        stopAudio();   // stop any playing speech

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            showVoiceError('Microphone access denied.');
            return;
        }

        audioChunks = [];
        // Prefer webm/opus; fall back to whatever the browser supports
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';

        mediaRecorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.start();
        isRecording = true;

        micBtn.classList.add('recording');
        micBtn.setAttribute('aria-label', 'Recording — release to transcribe');
        recordingIndicator.classList.remove('hidden');
    }

    async function stopRecording() {
        if (!isRecording || !mediaRecorder) return;
        isRecording = false;

        micBtn.classList.remove('recording');
        micBtn.setAttribute('aria-label', 'Hold to record voice message');
        recordingIndicator.classList.add('hidden');

        // Stop all tracks
        mediaRecorder.stream.getTracks().forEach(t => t.stop());

        // Wait for the final dataavailable event
        await new Promise(resolve => {
            mediaRecorder.onstop = resolve;
            mediaRecorder.stop();
        });

        if (audioChunks.length === 0) return;

        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunks, { type: mimeType });
        audioChunks = [];

        await transcribe(blob, mimeType);
    }

    function cancelRecordingIfActive() {
        if (isRecording) stopRecording();
    }

    // ── Transcription ─────────────────────────────────────────────────────────

    async function transcribe(blob, mimeType) {
        const token = localStorage.getItem('authToken');
        if (!token) return;

        // Show a spinner in the textarea
        const messageInput = document.getElementById('message-input');
        const origPlaceholder = messageInput.placeholder;
        messageInput.placeholder = 'Transcribing…';
        micBtn.disabled = true;

        const ext  = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        const form = new FormData();
        form.append('file', blob, `recording.${ext}`);

        try {
            const res = await fetch(`${API_URL}/voice/transcribe`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: form
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showVoiceError(err.detail || 'Transcription failed.');
                return;
            }

            const data = await res.json();
            if (data.transcript) {
                messageInput.value = data.transcript;
                messageInput.focus();
                // Auto-send after a short delay so the user can see what was transcribed
                setTimeout(() => {
                    if (typeof sendMessage === 'function') sendMessage();
                }, 600);
            }
        } catch {
            showVoiceError('Could not reach the transcription service.');
        } finally {
            messageInput.placeholder = origPlaceholder;
            micBtn.disabled = false;
        }
    }

    // ── Text-to-Speech ────────────────────────────────────────────────────────

    async function speak(text, messageEl) {
        const token = localStorage.getItem('authToken');
        if (!token || !text.trim()) return;

        stopAudio();

        // Highlight the message being spoken
        if (messageEl) messageEl.classList.add('speaking');

        try {
            const res = await fetch(`${API_URL}/voice/speak`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ text, voice: ttsVoice })
            });

            if (!res.ok) return;

            const audioBlob = await res.blob();
            const url = URL.createObjectURL(audioBlob);
            currentAudio = new Audio(url);
            currentAudio.onended = () => {
                URL.revokeObjectURL(url);
                currentAudio = null;
                if (messageEl) messageEl.classList.remove('speaking');
            };
            currentAudio.play();
        } catch {
            if (messageEl) messageEl.classList.remove('speaking');
        }
    }

    function stopAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        // Remove speaking highlight from all messages
        document.querySelectorAll('.message.speaking').forEach(el => el.classList.remove('speaking'));
    }

    // ── Patch app.js addMessage to hook into new assistant messages ───────────

    function patchAddMessage() {
        // app.js defines addMessage in the global scope — we wrap it
        const original = window.addMessage;
        if (typeof original !== 'function') return;

        window.addMessage = function (text, role) {
            const msgId = original(text, role);

            if (role === 'assistant' && voiceEnabled) {
                // Find the newly added message element by its data-id
                requestAnimationFrame(() => {
                    const el = document.querySelector(`[data-id="${msgId}"]`);
                    if (el) speak(text, el);
                });
            }

            return msgId;
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function showVoiceError(msg) {
        // Reuse the assistant message style as a one-time error notice
        const messagesContainer = document.getElementById('messages-container');
        if (!messagesContainer) return;
        const div = document.createElement('div');
        div.className = 'message assistant';
        div.style.background = '#fee';
        div.style.color = '#c33';
        div.textContent = '🎙️ ' + msg;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        setTimeout(() => div.remove(), 5000);
    }

    // ── Expose for settings page (voice toggle without full reload) ────────────
    window.voiceModule = {
        setVoiceEnabled: (val) => { voiceEnabled = val; },
        setTtsVoice:     (val) => { ttsVoice = val; },
        stopAudio,
        reinit: () => {
            const t = localStorage.getItem('authToken');
            if (t) initVoice(t);
        }
    };

}());
