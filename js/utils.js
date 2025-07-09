// 工具函数

// 计算两点之间的距离（米）
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // 地球半径，单位米
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // 距离（米）
    
    return distance;
}

// 角度转弧度
function deg2rad(deg) {
    return deg * (Math.PI/180);
}

// 格式化距离显示
function formatDistance(meters) {
    if (meters >= 1000) {
        return (meters / 1000).toFixed(1) + 'km';
    }
    return Math.round(meters) + 'm';
}

// 格式化时长显示
function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}'${remainingSeconds.toString().padStart(2, '0')}"`;
}

// HTTP请求封装
async function request(url, options = {}) {
    const defaultOptions = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        ...options
    };

    try {
        const response = await fetch(url, defaultOptions);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Request failed:', error);
        throw error;
    }
}

// 页面切换函数
function showPage(pageId) {
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => {
        page.classList.remove('active');
    });
    
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    }
}

// 获取URL参数
function getUrlParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// 设置URL参数
function setUrlParameter(name, value) {
    const url = new URL(window.location);
    url.searchParams.set(name, value);
    window.history.pushState({}, '', url);
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 节流函数
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// 本地存储封装
const storage = {
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.error('Storage set error:', error);
        }
    },
    
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.error('Storage get error:', error);
            return defaultValue;
        }
    },
    
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.error('Storage remove error:', error);
        }
    },
    
    clear() {
        try {
            localStorage.clear();
        } catch (error) {
            console.error('Storage clear error:', error);
        }
    }
};

// 音频工具函数
const audioUtils = {
    // 检查音频支持
    isSupported() {
        const audio = document.createElement('audio');
        return !!(audio.canPlayType && audio.canPlayType('audio/mpeg;').replace(/no/, ''));
    },
    
    // 格式化音频时长
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    },
    
    // 创建音频元素
    createAudio(src) {
        const audio = new Audio();
        audio.src = src;
        audio.preload = 'metadata';
        return audio;
    }
};

// 音频权限管理工具函数
const AudioPermissionManager = {
    // 检查浏览器音频支持
    checkAudioSupport() {
        const support = {
            webAudioAPI: typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined',
            mediaSession: 'mediaSession' in navigator,
            autoplay: 'autoplay' in HTMLAudioElement.prototype,
            backgroundPlayback: false
        };
        
        // 检查后台播放支持
        if (support.mediaSession) {
            support.backgroundPlayback = true;
        }
        
        // 检查iOS Safari的特殊支持
        if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
            support.backgroundPlayback = false; // iOS Safari不支持真正的后台播放
        }
        
        return support;
    },
    
    // 请求音频权限
    async requestAudioPermission() {
        try {
            // 创建音频上下文来触发权限请求
            const AudioContextClass = AudioContext || webkitAudioContext;
            const audioContext = new AudioContextClass();
            
            // 如果上下文被暂停，尝试恢复
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            
            return {
                success: true,
                state: audioContext.state,
                context: audioContext
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    },
    
    // 创建支持后台播放的音频元素
    createBackgroundAudio(src, options = {}) {
        const audio = document.createElement('audio');
        audio.src = src;
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';
        
        // 设置音频属性
        if (options.volume !== undefined) audio.volume = options.volume;
        if (options.loop !== undefined) audio.loop = options.loop;
        if (options.muted !== undefined) audio.muted = options.muted;
        
        // 设置媒体会话元数据（支持后台播放）
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: options.title || 'WalkingWhisper Audio',
                artist: options.artist || 'WalkingWhisper',
                album: options.album || 'Location-based Audio',
                artwork: options.artwork || []
            });
        }
        
        return audio;
    },
    
    // 设置媒体会话控制
    setupMediaSessionControls(audio, callbacks = {}) {
        if (!('mediaSession' in navigator)) return;
        
        navigator.mediaSession.setActionHandler('play', () => {
            audio.play();
            if (callbacks.onPlay) callbacks.onPlay();
        });
        
        navigator.mediaSession.setActionHandler('pause', () => {
            audio.pause();
            if (callbacks.onPause) callbacks.onPause();
        });
        
        navigator.mediaSession.setActionHandler('stop', () => {
            audio.pause();
            audio.currentTime = 0;
            if (callbacks.onStop) callbacks.onStop();
        });
        
        navigator.mediaSession.setActionHandler('seekbackward', () => {
            audio.currentTime = Math.max(0, audio.currentTime - 10);
        });
        
        navigator.mediaSession.setActionHandler('seekforward', () => {
            audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
        });
    },
    
    // 处理音频播放错误
    handleAudioError(error, audioElement) {
        const errorInfo = {
            type: 'unknown',
            message: error.message || '未知错误',
            recoverable: false
        };
        
        // 分析错误类型
        if (error.message.includes('permission') || error.message.includes('user agent') || error.message.includes('platform')) {
            errorInfo.type = 'permission';
            errorInfo.recoverable = true;
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
            errorInfo.type = 'network';
            errorInfo.recoverable = true;
        } else if (error.message.includes('decode')) {
            errorInfo.type = 'decode';
            errorInfo.recoverable = false;
        }
        
        return errorInfo;
    },
    
    // 获取音频播放状态
    getAudioPlaybackState() {
        const state = {
            canPlay: false,
            reason: '',
            suggestions: []
        };
        
        // 检查用户交互
        if (!document.hasFocus()) {
            state.reason = '页面未获得焦点';
            state.suggestions.push('请确保页面处于活动状态');
        }
        
        // 检查音频上下文状态
        if (typeof AudioContext !== 'undefined') {
            try {
                const audioContext = new AudioContext();
                if (audioContext.state === 'suspended') {
                    state.reason = '音频上下文被暂停';
                    state.suggestions.push('请点击页面以激活音频播放');
                } else if (audioContext.state === 'running') {
                    state.canPlay = true;
                }
                audioContext.close();
            } catch (error) {
                state.reason = '音频上下文创建失败';
                state.suggestions.push('请刷新页面重试');
            }
        }
        
        return state;
    }
};

// 导出音频权限管理器
window.AudioPermissionManager = AudioPermissionManager;

// 导出工具函数
window.utils = {
    calculateDistance,
    formatDistance,
    formatDuration,
    request,
    showPage,
    getUrlParameter,
    setUrlParameter,
    debounce,
    throttle,
    storage,
    audioUtils,
    
    // 清除位置权限缓存（用于测试）
    clearLocationPermission() {
        localStorage.removeItem('locationPermissionRequested');
        console.log('Location permission cache cleared');
        if (window.app) {
            window.app.hasRequestedPermission = false;
        }
    }
}; 