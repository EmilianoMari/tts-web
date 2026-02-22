/**
 * TTS Web - Sintesi Vocale AI (Multi-backend)
 * Streaming playback: audio chunks play as they're generated.
 * Supports: Chatterbox, Kokoro, CosyVoice2, ElevenLabs Turbo v2.5, ElevenLabs v3
 */

const MODELS = {
    chatterbox:       { name: 'Chatterbox',    param: 'exaggeration', paramLabel: 'Emozione',  paramMin: 0, paramMax: 2, paramStep: 0.1, paramDefault: 0.5, model: null },
    kokoro:           { name: 'Kokoro',        param: 'speed',        paramLabel: 'Velocit\u00e0', paramMin: 0.5, paramMax: 2, paramStep: 0.1, paramDefault: 1.0, model: null },
'elevenlabs-turbo': { name: 'ElevenLabs Turbo', param: 'stability', paramLabel: 'Stabilit\u00e0', paramMin: 0, paramMax: 1, paramStep: 0.05, paramDefault: 0.5, model: 'turbo' },
    'elevenlabs-v3':    { name: 'ElevenLabs v3',    param: 'stability', paramLabel: 'Stabilit\u00e0', paramMin: 0, paramMax: 1, paramStep: 0.05, paramDefault: 0.5, model: 'multilingual' },
};

class TTSApp {
    constructor() {
        this.currentModel = 'chatterbox';
        this.apiUrl = window.TTS_API_URL || 'https://chatterbox.agent24.it';
        this.audioContext = null;
        this.analyser = null;
        this.sourceNode = null;
        this.isPlaying = false;
        this.currentAudioUrl = null;
        this.animationId = null;
        this.timerInterval = null;
        this.timerStartTime = null;

        // Streaming state
        this.streamMode = false;
        this.streamSources = [];
        this.streamBuffers = [];
        this.streamPlayTime = 0;
        this.streamStartTime = 0;
        this.streamTotalDuration = 0;
        this.analyserConnected = false;

        this.initElements();
        this.initEvents();
        this.initAudioContext();
        this.loadLanguages();
        this.loadVoices();
    }

    initElements() {
        this.textInput = document.getElementById('text-input');
        this.voiceSelect = document.getElementById('voice-select');
        this.voiceField = document.getElementById('voice-field');
        this.languageSelect = document.getElementById('language-select');
        this.paramRange = document.getElementById('emotion-range');
        this.paramValue = document.getElementById('emotion-value');
        this.paramLabel = document.querySelector('[for="emotion-range"]');
        this.charCount = document.getElementById('char-count');
        this.charCounter = document.querySelector('.char-counter');
        this.generateBtn = document.getElementById('generate-btn');
        this.playerSection = document.getElementById('player-section');
        this.playBtn = document.getElementById('play-btn');
        this.playIcon = document.getElementById('play-icon');
        this.pauseIcon = document.getElementById('pause-icon');
        this.downloadBtn = document.getElementById('download-btn');
        this.audioPlayer = document.getElementById('audio-player');
        this.waveformCanvas = document.getElementById('waveform');
        this.progress = document.getElementById('progress');
        this.currentTimeEl = document.getElementById('current-time');
        this.durationEl = document.getElementById('duration');
        this.errorMessage = document.getElementById('error-message');
        this.generationTimer = document.getElementById('generation-timer');
        this.timerValue = document.getElementById('timer-value');
        this.timerModel = document.getElementById('timer-model');
        this.timerContent = this.generationTimer.querySelector('.timer-content');
        this.canvasCtx = this.waveformCanvas.getContext('2d');
        this.modelTabs = document.querySelectorAll('.model-tab');
    }

    initEvents() {
        this.textInput.addEventListener('input', () => this.updateCharCount());
        this.generateBtn.addEventListener('click', () => this.generateSpeech());
        this.playBtn.addEventListener('click', () => this.togglePlay());
        this.downloadBtn.addEventListener('click', () => this.downloadAudio());
        this.paramRange.addEventListener('input', () => {
            this.paramValue.textContent = this.paramRange.value;
        });

        // Model selector
        this.modelTabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchModel(tab));
        });

        // Reload voices when language changes (Kokoro has per-language voices)
        this.languageSelect.addEventListener('change', () => this.loadVoices());

        this.audioPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.audioPlayer.addEventListener('loadedmetadata', () => this.updateDuration());
        this.audioPlayer.addEventListener('ended', () => this.onAudioEnded());
        this.audioPlayer.addEventListener('play', () => this.onPlay());
        this.audioPlayer.addEventListener('pause', () => this.onPause());

        document.querySelectorAll('textarea').forEach(textarea => {
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return;
                e.stopPropagation();
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.generateSpeech();
            }
        });

        window.addEventListener('resize', () => this.resizeCanvas());
        this.resizeCanvas();
    }

    // ── Model switching ──────────────────────────────────────────────────

    switchModel(tab) {
        const modelId = tab.dataset.model;
        const modelUrl = tab.dataset.url;
        if (modelId === this.currentModel) return;

        this.currentModel = modelId;
        this.apiUrl = modelUrl;

        // Update tabs
        this.modelTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update parameter control (emotion for Chatterbox, speed for others)
        const cfg = MODELS[modelId];
        this.paramLabel.textContent = cfg.paramLabel;
        this.paramRange.min = cfg.paramMin;
        this.paramRange.max = cfg.paramMax;
        this.paramRange.step = cfg.paramStep;
        this.paramRange.value = cfg.paramDefault;
        this.paramValue.textContent = cfg.paramDefault;

        // Reload languages and voices from new backend
        this.loadLanguages();
        this.loadVoices();

        // Hide error
        this.hideError();
    }

    // ── Audio context ────────────────────────────────────────────────────

    initAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
        } catch (e) {
            console.warn('Web Audio API not supported');
        }
    }

    ensureAnalyserReady() {
        if (!this.audioContext || !this.analyser) return;
        if (!this.analyserConnected) {
            this.analyser.connect(this.audioContext.destination);
            this.analyserConnected = true;
        }
    }

    connectAudioSource() {
        if (!this.audioContext || !this.analyser) return;
        this.ensureAnalyserReady();
        if (!this.sourceNode) {
            this.sourceNode = this.audioContext.createMediaElementSource(this.audioPlayer);
            this.sourceNode.connect(this.analyser);
        }
    }

    // ── Data loading ─────────────────────────────────────────────────────

    async loadLanguages() {
        try {
            const response = await fetch(`${this.apiUrl}/languages`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const languages = await response.json();
            this.languageSelect.innerHTML = '';

            languages.forEach(lang => {
                const option = document.createElement('option');
                option.value = lang.code;
                option.textContent = lang.name;
                if (lang.code === 'it') option.selected = true;
                this.languageSelect.appendChild(option);
            });
        } catch (e) {
            console.warn('Failed to load languages:', e);
            this.languageSelect.innerHTML = '<option value="it">Italian</option><option value="en">English</option>';
        }
    }

    async loadVoices() {
        try {
            const url = this.currentModel === 'kokoro'
                ? `${this.apiUrl}/voices?language=${this.languageSelect.value || 'it'}`
                : `${this.apiUrl}/voices`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const voices = await response.json();
            this.voiceSelect.innerHTML = '';

            if (voices.length === 0) {
                this.voiceField.style.display = 'none';
            } else {
                this.voiceField.style.display = '';
                voices.forEach(voice => {
                    const option = document.createElement('option');
                    option.value = voice.file;
                    option.textContent = voice.name;
                    this.voiceSelect.appendChild(option);
                });
            }
        } catch (e) {
            console.warn('Failed to load voices:', e);
            this.voiceField.style.display = 'none';
        }
    }

    updateCharCount() {
        const count = this.textInput.value.length;
        this.charCount.textContent = count;
        if (this.charCounter) {
            this.charCounter.classList.toggle('warning', count > 900);
        }
    }

    // ── Streaming generation ────────────────────────────────────────────

    async generateSpeech() {
        const text = this.textInput.value.trim();
        const language = this.languageSelect.value;
        const voice = this.voiceSelect.value || null;
        const paramVal = parseFloat(this.paramRange.value);
        const cfg = MODELS[this.currentModel];

        if (!text) {
            this.showError('Inserisci del testo da convertire in voce.');
            return;
        }

        if (!language) {
            this.showError('Seleziona una lingua.');
            return;
        }

        this.hideError();
        this.setLoading(true);
        this.startTimer();
        this.stopStreamPlayback();

        // Update timer model name
        this.timerModel.textContent = cfg.name;

        try {
            const body = { text, language };
            body[cfg.param] = paramVal;
            if (voice) {
                // CosyVoice uses voice names without extension
                body.voice = this.currentModel === 'cosyvoice'
                    ? voice.replace(/\.(wav|flac)$/i, '')
                    : voice;
            }
            // ElevenLabs requires model parameter
            if (cfg.model) {
                body.model = cfg.model;
            }

            const response = await fetch(`${this.apiUrl}/synthesize/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.detail || `Errore server: ${response.status}`);
            }

            if (this.audioContext && this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            this.ensureAnalyserReady();

            await this.playStream(response);
        } catch (error) {
            this.stopTimer(true);
            this.stopStreamPlayback();
            console.error('TTS Error:', error);

            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                this.showError('Impossibile raggiungere il server. Verifica che il servizio TTS sia attivo.');
            } else {
                this.showError(error.message || 'Errore nella generazione audio. Riprova.');
            }
        } finally {
            this.setLoading(false);
        }
    }

    async playStream(response) {
        const reader = response.body.getReader();
        let buffer = new Uint8Array(0);

        this.streamBuffers = [];
        this.streamSources = [];
        this.streamMode = true;
        this.streamPlayTime = this.audioContext.currentTime + 0.05;
        this.streamStartTime = this.streamPlayTime;
        this.streamTotalDuration = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const newBuf = new Uint8Array(buffer.length + value.length);
            newBuf.set(buffer);
            newBuf.set(value, buffer.length);
            buffer = newBuf;

            while (buffer.length >= 4) {
                const view = new DataView(buffer.buffer, buffer.byteOffset, 4);
                const chunkLen = view.getUint32(0, true);

                if (chunkLen === 0) {
                    buffer = buffer.slice(4);
                    break;
                }

                if (buffer.length < 4 + chunkLen) break;

                const wavBytes = buffer.slice(4, 4 + chunkLen);
                buffer = buffer.slice(4 + chunkLen);

                if (this.streamBuffers.length === 0) {
                    this.stopTimer();
                    this.playerSection.classList.remove('hidden');
                }

                const arrayBuf = wavBytes.buffer.slice(
                    wavBytes.byteOffset,
                    wavBytes.byteOffset + wavBytes.byteLength
                );
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuf);
                this.streamBuffers.push(audioBuffer);

                const source = this.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.analyser);
                source.start(this.streamPlayTime);
                this.streamSources.push(source);

                this.streamPlayTime += audioBuffer.duration;
                this.streamTotalDuration += audioBuffer.duration;
                this.durationEl.textContent = this.formatTime(this.streamTotalDuration);

                if (!this.isPlaying) {
                    this.isPlaying = true;
                    this.playIcon.classList.add('hidden');
                    this.pauseIcon.classList.remove('hidden');
                    this.startVisualization();
                    this.trackStreamProgress();
                }
            }
        }

        if (this.streamBuffers.length === 0) {
            throw new Error('Il server ha restituito un audio vuoto. Riprova.');
        }

        this.createDownloadableAudio();

        const lastSource = this.streamSources[this.streamSources.length - 1];
        lastSource.onended = () => {
            if (this.streamMode) this.onStreamEnded();
        };
    }

    stopStreamPlayback() {
        if (this.streamSources) {
            this.streamSources.forEach(s => { try { s.stop(); } catch (e) { /* already stopped */ } });
        }
        this.streamSources = [];
        this.streamBuffers = [];
        this.streamMode = false;
        this.streamTotalDuration = 0;
    }

    trackStreamProgress() {
        if (!this.isPlaying || !this.streamMode) return;

        const elapsed = this.audioContext.currentTime - this.streamStartTime;
        if (this.streamTotalDuration > 0) {
            const pct = Math.min(elapsed / this.streamTotalDuration, 1);
            this.progress.style.width = `${pct * 100}%`;
            this.currentTimeEl.textContent = this.formatTime(Math.max(0, elapsed));
        }

        requestAnimationFrame(() => this.trackStreamProgress());
    }

    onStreamEnded() {
        this.isPlaying = false;
        this.streamMode = false;
        this.playIcon.classList.remove('hidden');
        this.pauseIcon.classList.add('hidden');
        this.progress.style.width = '0%';
        this.currentTimeEl.textContent = '0:00';
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.drawIdleWaveform();

        if (this.currentAudioUrl) {
            this.audioPlayer.src = this.currentAudioUrl;
            this.connectAudioSource();
        }
    }

    createDownloadableAudio() {
        if (!this.streamBuffers.length) return;

        const totalLength = this.streamBuffers.reduce((sum, buf) => sum + buf.length, 0);
        const sampleRate = this.streamBuffers[0].sampleRate;
        const numChannels = this.streamBuffers[0].numberOfChannels;

        const channels = [];
        for (let ch = 0; ch < numChannels; ch++) {
            const data = new Float32Array(totalLength);
            let offset = 0;
            for (const buf of this.streamBuffers) {
                data.set(buf.getChannelData(ch), offset);
                offset += buf.length;
            }
            channels.push(data);
        }

        const bytesPerSample = 2;
        const blockAlign = numChannels * bytesPerSample;
        const dataLength = totalLength * blockAlign;
        const wavBuffer = new ArrayBuffer(44 + dataLength);
        const v = new DataView(wavBuffer);

        const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
        writeStr(0, 'RIFF');
        v.setUint32(4, 36 + dataLength, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, numChannels, true);
        v.setUint32(24, sampleRate, true);
        v.setUint32(28, sampleRate * blockAlign, true);
        v.setUint16(32, blockAlign, true);
        v.setUint16(34, 16, true);
        writeStr(36, 'data');
        v.setUint32(40, dataLength, true);

        let pos = 44;
        for (let i = 0; i < totalLength; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = Math.max(-1, Math.min(1, channels[ch][i]));
                v.setInt16(pos, sample * 0x7FFF, true);
                pos += 2;
            }
        }

        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        if (this.currentAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
        this.currentAudioUrl = URL.createObjectURL(blob);
    }

    // ── Playback controls ───────────────────────────────────────────────

    togglePlay() {
        if (this.streamMode) {
            if (this.audioContext.state === 'running') {
                this.audioContext.suspend();
                this.isPlaying = false;
                this.playIcon.classList.remove('hidden');
                this.pauseIcon.classList.add('hidden');
            } else {
                this.audioContext.resume();
                this.isPlaying = true;
                this.playIcon.classList.add('hidden');
                this.pauseIcon.classList.remove('hidden');
                this.startVisualization();
                this.trackStreamProgress();
            }
            return;
        }

        if (!this.audioPlayer.src) return;
        if (this.audioPlayer.paused) {
            this.audioPlayer.play();
        } else {
            this.audioPlayer.pause();
        }
    }

    onPlay() {
        this.isPlaying = true;
        this.playIcon.classList.add('hidden');
        this.pauseIcon.classList.remove('hidden');
        this.startVisualization();
    }

    onPause() {
        this.isPlaying = false;
        this.playIcon.classList.remove('hidden');
        this.pauseIcon.classList.add('hidden');
    }

    onAudioEnded() {
        this.isPlaying = false;
        this.playIcon.classList.remove('hidden');
        this.pauseIcon.classList.add('hidden');
        this.progress.style.width = '0%';
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.drawIdleWaveform();
    }

    updateProgress() {
        const { currentTime, duration } = this.audioPlayer;
        if (duration) {
            this.progress.style.width = `${(currentTime / duration) * 100}%`;
            this.currentTimeEl.textContent = this.formatTime(currentTime);
        }
    }

    updateDuration() {
        this.durationEl.textContent = this.formatTime(this.audioPlayer.duration);
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    downloadAudio() {
        if (!this.currentAudioUrl) return;
        const a = document.createElement('a');
        a.href = this.currentAudioUrl;
        a.download = 'tts-audio.wav';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // ── Waveform visualization ──────────────────────────────────────────

    resizeCanvas() {
        const container = this.waveformCanvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();

        this.waveformCanvas.width = rect.width * dpr;
        this.waveformCanvas.height = rect.height * dpr;
        this.waveformCanvas.style.width = rect.width + 'px';
        this.waveformCanvas.style.height = rect.height + 'px';

        this.canvasCtx.scale(dpr, dpr);
        this.displayWidth = rect.width;
        this.displayHeight = rect.height;

        if (!this.isPlaying) this.drawIdleWaveform();
    }

    drawIdleWaveform() {
        const w = this.displayWidth || this.waveformCanvas.width;
        const h = this.displayHeight || this.waveformCanvas.height;
        const ctx = this.canvasCtx;

        ctx.clearRect(0, 0, w, h);

        const centerY = h / 2;
        const barCount = 50;
        const barWidth = 2;
        const gap = (w - barCount * barWidth) / (barCount - 1);

        for (let i = 0; i < barCount; i++) {
            const x = i * (barWidth + gap);
            const amplitude = 3 + Math.sin(i * 0.15) * 5 + Math.sin(i * 0.08 + 1) * 3;
            ctx.fillStyle = 'rgba(249, 115, 22, 0.12)';
            ctx.beginPath();
            ctx.roundRect(x, centerY - amplitude, barWidth, amplitude * 2, 1);
            ctx.fill();
        }
    }

    startVisualization() {
        if (!this.analyser) {
            this.drawIdleWaveform();
            return;
        }

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!this.isPlaying) {
                this.drawIdleWaveform();
                return;
            }

            this.animationId = requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(dataArray);

            const w = this.displayWidth || this.waveformCanvas.width;
            const h = this.displayHeight || this.waveformCanvas.height;
            const ctx = this.canvasCtx;

            ctx.clearRect(0, 0, w, h);

            const centerY = h / 2;
            const barCount = 50;
            const barWidth = 2;
            const gap = (w - barCount * barWidth) / (barCount - 1);
            const step = Math.floor(bufferLength / barCount);

            for (let i = 0; i < barCount; i++) {
                const x = i * (barWidth + gap);
                const dataIdx = i * step;
                const value = dataArray[dataIdx] || 0;
                const normalizedHeight = (value / 255) * (h * 0.8);
                const barHeight = Math.max(normalizedHeight, 2);
                const intensity = value / 255;
                const alpha = 0.15 + intensity * 0.7;

                ctx.fillStyle = `rgba(249, 115, 22, ${alpha * 0.25})`;
                ctx.beginPath();
                ctx.roundRect(x, centerY, barWidth, barHeight / 2, 1);
                ctx.fill();

                ctx.fillStyle = `rgba(249, 115, 22, ${alpha})`;
                ctx.beginPath();
                ctx.roundRect(x, centerY - barHeight / 2, barWidth, barHeight / 2, 1);
                ctx.fill();
            }
        };

        draw();
    }

    // ── Timer ───────────────────────────────────────────────────────────

    startTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);

        this.timerStartTime = performance.now();
        this.generationTimer.classList.remove('hidden');
        this.timerContent.classList.remove('completed');
        this.timerValue.textContent = '0.0s';

        this.timerInterval = setInterval(() => {
            const elapsed = (performance.now() - this.timerStartTime) / 1000;
            this.timerValue.textContent = this.formatTimer(elapsed);
        }, 100);
    }

    stopTimer(isError = false) {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        if (this.timerStartTime) {
            const elapsed = (performance.now() - this.timerStartTime) / 1000;
            this.timerValue.textContent = this.formatTimer(elapsed);
            if (!isError) this.timerContent.classList.add('completed');
            this.timerStartTime = null;
        }

        if (isError) {
            setTimeout(() => this.generationTimer.classList.add('hidden'), 3000);
        }
    }

    formatTimer(seconds) {
        if (seconds < 60) return `${seconds.toFixed(1)}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs.toFixed(1)}s`;
    }

    setLoading(loading) {
        this.generateBtn.classList.toggle('loading', loading);
        this.generateBtn.disabled = loading;
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.classList.remove('hidden');
    }

    hideError() {
        this.errorMessage.classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.ttsApp = new TTSApp();
});
