/**
 * VoiceForge - TTS Frontend
 */

class VoiceForge {
    constructor() {
        this.apiUrl = window.TTS_API_URL || 'https://qwen-tts.fr3e.it';
        this.audioContext = null;
        this.analyser = null;
        this.audioBuffer = null;
        this.isPlaying = false;

        this.initElements();
        this.initEvents();
        this.initAudioContext();
    }

    initElements() {
        this.textInput = document.getElementById('text-input');
        this.charCount = document.getElementById('char-count');
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

        this.canvasCtx = this.waveformCanvas.getContext('2d');
    }

    initEvents() {
        // Text input
        this.textInput.addEventListener('input', () => this.updateCharCount());

        // Generate button
        this.generateBtn.addEventListener('click', () => this.generateSpeech());

        // Play/Pause
        this.playBtn.addEventListener('click', () => this.togglePlay());

        // Download
        this.downloadBtn.addEventListener('click', () => this.downloadAudio());

        // Audio events
        this.audioPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.audioPlayer.addEventListener('loadedmetadata', () => this.updateDuration());
        this.audioPlayer.addEventListener('ended', () => this.onAudioEnded());
        this.audioPlayer.addEventListener('play', () => this.onPlay());
        this.audioPlayer.addEventListener('pause', () => this.onPause());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                this.generateSpeech();
            }
            if (e.key === ' ' && document.activeElement !== this.textInput) {
                e.preventDefault();
                this.togglePlay();
            }
        });

        // Resize canvas
        window.addEventListener('resize', () => this.resizeCanvas());
        this.resizeCanvas();
    }

    initAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
        } catch (e) {
            console.warn('Web Audio API not supported');
        }
    }

    updateCharCount() {
        const count = this.textInput.value.length;
        this.charCount.textContent = count;
        this.charCount.parentElement.classList.toggle('warning', count > 500);
    }

    async generateSpeech() {
        const text = this.textInput.value.trim();

        if (!text) {
            this.showError('Please enter some text to convert to speech.');
            return;
        }

        if (text.length > 500) {
            this.showError('Text is too long. Maximum 500 characters allowed.');
            return;
        }

        this.hideError();
        this.setLoading(true);

        try {
            const response = await fetch(`${this.apiUrl}/tts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.detail || `Server error: ${response.status}`);
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            this.audioPlayer.src = audioUrl;
            this.currentAudioUrl = audioUrl;
            this.playerSection.classList.remove('hidden');

            // Connect to analyser for visualization
            if (this.audioContext && this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // Auto-play
            this.audioPlayer.play();

        } catch (error) {
            console.error('TTS Error:', error);
            this.showError(error.message || 'Failed to generate speech. Please try again.');
        } finally {
            this.setLoading(false);
        }
    }

    togglePlay() {
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
    }

    updateProgress() {
        const { currentTime, duration } = this.audioPlayer;
        if (duration) {
            const percent = (currentTime / duration) * 100;
            this.progress.style.width = `${percent}%`;
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
        a.download = 'voiceforge-audio.wav';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    resizeCanvas() {
        const container = this.waveformCanvas.parentElement;
        this.waveformCanvas.width = container.offsetWidth;
        this.waveformCanvas.height = container.offsetHeight;
        this.drawIdleWaveform();
    }

    drawIdleWaveform() {
        const { width, height } = this.waveformCanvas;
        const ctx = this.canvasCtx;

        ctx.clearRect(0, 0, width, height);

        // Draw idle wave
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.lineWidth = 2;

        const centerY = height / 2;
        ctx.moveTo(0, centerY);

        for (let x = 0; x < width; x++) {
            const y = centerY + Math.sin(x * 0.02) * 10;
            ctx.lineTo(x, y);
        }

        ctx.stroke();
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

            requestAnimationFrame(draw);

            this.analyser.getByteFrequencyData(dataArray);

            const { width, height } = this.waveformCanvas;
            const ctx = this.canvasCtx;

            ctx.clearRect(0, 0, width, height);

            const barWidth = (width / bufferLength) * 2.5;
            let x = 0;

            const gradient = ctx.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, '#6366f1');
            gradient.addColorStop(0.5, '#22d3ee');
            gradient.addColorStop(1, '#f472b6');

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * height * 0.8;

                ctx.fillStyle = gradient;
                ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

                x += barWidth;
            }
        };

        draw();
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.voiceForge = new VoiceForge();
});
