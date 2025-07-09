// 详情页逻辑
class DetailPage {
    constructor() {
        this.itemDetail = null;
        this.centerLocation = null;
        this.markers = [];
        this.scale = 14;
        this.audioManager = null;
        this.isPlaying = false;
        this.progress = 0;
        this.buttonText = 'start tracking and playing';
        this.isLoading = true;
        this.audioRecords = [];
        this.isTracking = false;
        this.isButtonDisabled = false;
        this.map = null;
        this.leafletMarkers = [];
        this.userMarker = null; // 用户位置标记
        this.currentPlayingRecord = null; // 当前播放的音频记录
        this.userId = null; // 用户ID
        this.storedData = null; // 存储的数据
        this.isInitializing = false; // 防止重复初始化的标志
        
        // 多音频播放管理
        this.audioPlayers = new Map(); // 存储所有音频播放器 {record_id: audioElement}
        this.playingRecords = new Set(); // 当前正在播放的record_id集合
        this.audioLoadingStates = new Map(); // 音频加载状态 {record_id: 'loading'|'loaded'|'error'}
        
        // 音频范围状态跟踪
        this.audioRangeStates = new Map(); // 音频范围状态 {record_id: {inRange: boolean, lastCheckTime: number, hasPlayedInRange: boolean}}
        
        // 防抖机制
        this.proximityCheckTimeout = null;
        this.lastProximityCheck = 0;
        this.proximityCheckInterval = 1000; // 1秒间隔追踪距离变化
        
        // 调试日志系统
        this.debugEnabled = false; // Debug功能开关
        this.debugLogs = []; // 存储格式化的日志字符串
        this.debugLogObjects = []; // 存储日志对象 {timestamp, message, type}
        this.maxDebugLogs = 10; // 最多显示10条日志
        
        // 音频权限和后台播放管理
        this.audioContext = null; // Web Audio API 上下文
        this.audioPermissionGranted = false; // 音频权限状态
        this.userInteracted = false; // 用户是否已交互
        this.backgroundAudioEnabled = false; // 后台播放是否启用
        this.audioResumeQueue = []; // 需要恢复播放的音频队列
        this.visibilityChangeHandler = null; // 页面可见性变化处理器
        
        this.bindEvents();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        // 播放按钮事件
        const playButton = document.getElementById('play-button');
        if (playButton) {
            playButton.addEventListener('click', () => {
                this.handlePlayAudio();
            });
        }

        // 返回按钮事件
        const backButton = document.getElementById('back-button');
        if (backButton) {
            backButton.addEventListener('click', () => {
                this.goBack();
            });
        }
        
        // 音频权限和后台播放管理
        this.initAudioPermissions();
        this.setupVisibilityChangeHandler();
        
        // 监听用户交互以启用音频播放
        document.addEventListener('touchstart', () => {
            this.userInteracted = true;
            this.tryResumeAudioContext();
        }, { once: true });
        
        document.addEventListener('click', () => {
            this.userInteracted = true;
            this.tryResumeAudioContext();
        }, { once: true });
    }

    async init(id, userId, userName) {
        // console.log('Detail page init:', id, userId, userName);
        this.userId = userId;
        
        // 设置位置更新回调
        window.app.setLocationCallback((location) => {
            // console.log('Detail page location callback triggered:', location);
            this.onLocationUpdate(location);
        });
        
        // 获取当前位置
        const currentLocation = window.app.globalData.currentLocation;
        console.log('Current location from globalData:', currentLocation);

        // 如果有位置信息，立即初始化；否则等待位置更新
        if (currentLocation) {
            await this.initializePageData(userId, currentLocation, id, userName);
        } else {
            console.log('Waiting for location permission before initializing page');
            this.setLoading(true);
        }
    }

    // 初始化页面数据
    async initializePageData(userId, currentLocation, id, userName) {
        // 如果是从位置更新回调调用的，不需要重新设置loading状态
        if (!this.map) {
            this.setLoading(true);
        }
        
        // 检查是否有缓存数据
        const cachedData = this.getDataFromLocalStorage(userId);
        if (cachedData && cachedData.locations && cachedData.locations.length > 0) {
            console.log('Using cached data for faster loading');
            // 使用缓存数据快速初始化
            this.storedData = cachedData;
            
            // 构建itemDetail对象
            const itemDetail = {
                id: userId,
                title: cachedData.workInfo?.workname || '音频作品',
                author: userName || userId,
                creationTime: new Date().toISOString().split('T')[0],
                description: cachedData.workInfo?.brief_intro || '声景作品',
                locations: cachedData.locations
            };

            this.setData({
                itemDetail
            });

            // 初始化地图
            this.initMap(currentLocation, cachedData.locations);
            this.initAudioManager();
            this.setLoading(false);
            this.isInitializing = false;
            
            // 更新调试信息
            this.updateDebugInfo();
            
            // 后台更新数据
            this.updateDataInBackground(userId, userName);
            return;
        }
        
        try {
            // 1. 调用get/locationMarkers接口
            const locationMarkersData = await this.fetchLocationMarkers(userId);
            
            if (!locationMarkersData) {
                this.setLoading(false);
                this.isInitializing = false; // 重置初始化标志
                window.app.showToast('该作品暂无位置数据');
                return;
            }

            // 2. 调用get/recordsList接口获取所有音频记录
            const audioRecordsData = await this.fetchAllAudioRecords(userId, locationMarkersData.markers);
            
            // 3. 筛选出符合条件的marker
            const validMarkers = this.filterValidMarkers(locationMarkersData.markers, audioRecordsData);
            
            if (validMarkers.length === 0) {
                this.setLoading(false);
                this.isInitializing = false; // 重置初始化标志
                window.app.showToast('该作品暂无可播放的音频点');
                return;
            }

            // 4. 构建完整的数据结构并存储到localStorage
            const completeData = {
                locations: validMarkers,
                records: audioRecordsData,
                workInfo: {
                    workname: locationMarkersData.workname,
                    brief_intro: locationMarkersData.brief_intro
                }
            };
            
            this.storeDataToLocalStorage(userId, completeData);
            this.storedData = completeData;

            // 5. 构建itemDetail对象
            const itemDetail = {
                id: userId,
                title: locationMarkersData.workname || '音频作品',
                author: userName || userId,
                creationTime: new Date().toISOString().split('T')[0],
                description: locationMarkersData.brief_intro || `声景作品：${locationMarkersData.brief_intro || '未知作品'}`,
                locations: validMarkers
            };

            this.setData({
                itemDetail
            });

            // 6. 初始化地图（使用筛选后的有效markers）
            this.initMap(currentLocation, validMarkers);

            // 7. 初始化音频管理器
            this.initAudioManager();
            
            // 8. 关闭加载状态并重置初始化标志
            this.setLoading(false);
            this.isInitializing = false;
            
            // 更新调试信息
            this.updateDebugInfo();
            
        } catch (error) {
            console.error('初始化页面数据失败:', error);
            this.setLoading(false);
            this.isInitializing = false; // 重置初始化标志
            window.app.showToast('获取数据失败');
        }
    }

    // 获取位置标记数据
    async fetchLocationMarkers(userId) {
        const url = `https://nyw6vsud2p.ap-northeast-1.awsapprunner.com/api/v1/get/locationMarkers?user_id=${userId}`;
        
        try {
            const res = await window.utils.request(url);
            // console.log('LocationMarkers API Response:', res);

            if (res.code === 200 && res.data && res.data.markers) {
                return {
                    markers: res.data.markers,
                    workname: res.data.workname,
                    brief_intro: res.data.brief_intro
                };
            }
            return null;
        } catch (error) {
            console.error('获取位置标记失败:', error);
            throw error;
        }
    }

    // 获取所有音频记录（并行优化）
    async fetchAllAudioRecords(userId, markers) {
        const allRecords = {};
        
        // 只处理isShow为true的markers
        const validMarkers = markers.filter(marker => marker.isShow);
        
        if (validMarkers.length === 0) {
            return allRecords;
        }
        
        // 并行请求所有音频记录
        const promises = validMarkers.map(async (marker) => {
            try {
                const url = `https://nyw6vsud2p.ap-northeast-1.awsapprunner.com/api/v1/get/recordsList?user_id=${userId}&latitude=${parseFloat(marker.latitude)}&longitude=${parseFloat(marker.longitude)}`;
                const res = await window.utils.request(url);
                
                if (res.code === 200 && res.data.length > 0) {
                    // console.log('API response for marker:', marker.latitude, marker.longitude, 'data:', res.data);
                    // 只保存isPlay为true的音频记录，并提取play_range中的参数
                    const records = res.data.filter(record => record.isPlay).map(record => {
                        // 从play_range中提取outer_radius和inner_radius
                        if (record.play_range) {
                            record.outer_radius = record.play_range.outer_radius;
                            record.inner_radius = record.play_range.inner_radius;
                        }
                        return record;
                    });
                    if (records.length > 0) {
                        // console.log('Filtered playable records with radius:', records);
                        return {
                            key: `${marker.latitude}_${marker.longitude}`,
                            data: {
                                location: marker,
                                records: records
                            }
                        };
                    }
                }
            } catch (error) {
                console.warn(`获取音频记录失败 (${marker.latitude}, ${marker.longitude}):`, error);
            }
            return null;
        });
        
        // 等待所有请求完成
        const results = await Promise.all(promises);
        
        // 整理结果
        results.forEach(result => {
            if (result) {
                allRecords[result.key] = result.data;
            }
        });
        
        return allRecords;
    }

    // 筛选有效的marker（isShow为true且至少有一条isPlay为true的记录）
    filterValidMarkers(markers, audioRecords) {
        return markers.filter(marker => {
            if (!marker.isShow) return false;
            
            const key = `${marker.latitude}_${marker.longitude}`;
            const records = audioRecords[key];
            
            return records && records.records.length > 0;
        });
    }

    // 存储数据到localStorage
    storeDataToLocalStorage(userId, data) {
        const storageKey = `audio_data_${userId}`;
        localStorage.setItem(storageKey, JSON.stringify(data));
        console.log('数据已存储到localStorage:', storageKey, data);
    }

    // 从localStorage获取数据
    getDataFromLocalStorage(userId) {
        const storageKey = `audio_data_${userId}`;
        const data = localStorage.getItem(storageKey);
        return data ? JSON.parse(data) : null;
    }

    // 后台更新数据
    async updateDataInBackground(userId, userName) {
        try {
            console.log('Updating data in background...');
            const locationMarkersData = await this.fetchLocationMarkers(userId);
            if (!locationMarkersData) return;
            
            const audioRecordsData = await this.fetchAllAudioRecords(userId, locationMarkersData.markers);
            const validMarkers = this.filterValidMarkers(locationMarkersData.markers, audioRecordsData);
            
            if (validMarkers.length > 0) {
                const completeData = {
                    locations: validMarkers,
                    records: audioRecordsData,
                    workInfo: {
                        workname: locationMarkersData.workname,
                        brief_intro: locationMarkersData.brief_intro
                    }
                };
                
                this.storeDataToLocalStorage(userId, completeData);
                this.storedData = completeData;
                
                // 更新UI（如果数据有变化）
                if (this.itemDetail) {
                    this.itemDetail.title = locationMarkersData.workname || '音频作品';
                    this.itemDetail.description = locationMarkersData.brief_intro || '声景作品';
                    this.itemDetail.locations = validMarkers;
                    this.updateUI();
                }
                
                console.log('Background data update completed');
            }
        } catch (error) {
            console.warn('Background data update failed:', error);
        }
    }

    // 初始化音频权限
    async initAudioPermissions() {
        try {
            // 检查是否支持 Web Audio API
            if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
                this.audioContext = new (AudioContext || webkitAudioContext)();
                
                // 检查音频权限状态
                if (this.audioContext.state === 'suspended') {
                    this.addDebugLog('音频上下文已暂停，等待用户交互', 'warning');
                } else if (this.audioContext.state === 'running') {
                    this.audioPermissionGranted = true;
                    this.addDebugLog('音频权限已获取', 'success');
                }
            }
            
            // 检查是否支持后台播放
            this.checkBackgroundAudioSupport();
            
        } catch (error) {
            console.error('初始化音频权限失败:', error);
            this.addDebugLog(`音频权限初始化失败: ${error.message}`, 'error');
        }
    }
    
    // 检查后台播放支持
    checkBackgroundAudioSupport() {
        // 检查是否支持后台播放
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => {
                this.resumeAllAudio();
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                this.pauseAllAudio();
            });
            this.backgroundAudioEnabled = true;
            this.addDebugLog('后台播放支持已启用', 'success');
        } else {
            this.addDebugLog('当前浏览器不支持后台播放', 'warning');
        }
    }
    
    // 设置页面可见性变化处理器
    setupVisibilityChangeHandler() {
        this.visibilityChangeHandler = () => {
            if (document.hidden) {
                this.addDebugLog('页面进入后台', 'info');
                // 页面进入后台时的处理
                this.handlePageHidden();
            } else {
                this.addDebugLog('页面回到前台', 'info');
                // 页面回到前台时的处理
                this.handlePageVisible();
            }
        };
        
        document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }
    
    // 页面进入后台时的处理
    handlePageHidden() {
        // 保存当前播放状态
        this.audioResumeQueue = Array.from(this.playingRecords);
        
        // 尝试保持音频播放（如果支持后台播放）
        if (!this.backgroundAudioEnabled) {
            this.addDebugLog('暂停所有音频（不支持后台播放）', 'warning');
            this.pauseAllAudio();
        }
    }
    
    // 页面回到前台时的处理
    handlePageVisible() {
        // 恢复音频上下文
        this.tryResumeAudioContext();
        
        // 恢复之前播放的音频
        if (this.audioResumeQueue.length > 0 && this.backgroundAudioEnabled) {
            this.addDebugLog('恢复后台播放的音频', 'info');
            this.resumeQueuedAudio();
        }
    }
    
    // 尝试恢复音频上下文
    async tryResumeAudioContext() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                this.audioPermissionGranted = true;
                this.addDebugLog('音频上下文已恢复', 'success');
            } catch (error) {
                console.error('恢复音频上下文失败:', error);
                this.addDebugLog(`恢复音频上下文失败: ${error.message}`, 'error');
            }
        }
    }
    
    // 暂停所有音频
    pauseAllAudio() {
        for (const [recordId, audioElement] of this.audioPlayers) {
            if (!audioElement.paused) {
                audioElement.pause();
                this.addDebugLog(`音频 ${recordId} 已暂停`, 'info');
            }
        }
    }
    
    // 恢复所有音频
    resumeAllAudio() {
        for (const [recordId, audioElement] of this.audioPlayers) {
            if (audioElement.paused) {
                audioElement.play().catch(error => {
                    console.error(`恢复音频 ${recordId} 失败:`, error);
                    this.addDebugLog(`恢复音频 ${recordId} 失败: ${error.message}`, 'error');
                });
            }
        }
    }
    
    // 恢复队列中的音频
    async resumeQueuedAudio() {
        for (const recordId of this.audioResumeQueue) {
            const audioElement = this.audioPlayers.get(recordId);
            if (audioElement && audioElement.paused) {
                try {
                    await audioElement.play();
                    this.addDebugLog(`音频 ${recordId} 已恢复播放`, 'success');
                } catch (error) {
                    console.error(`恢复音频 ${recordId} 失败:`, error);
                    this.addDebugLog(`恢复音频 ${recordId} 失败: ${error.message}`, 'error');
                }
            }
        }
        this.audioResumeQueue = [];
    }

    // 播放音频文件（支持多音频同时播放）
    async playAudio(record, userId) {
        if (!record.record_id) return;
        
        const recordId = record.record_id;
        this.addDebugLog(`准备播放音频: ${recordId}`);
        
        // 检查是否正在播放相同的音频
        if (this.playingRecords.has(recordId)) {
            this.addDebugLog(`音频 ${recordId} 已在播放中，跳过`);
            return;
        }
        
        // 检查用户是否已交互
        if (!this.userInteracted) {
            this.addDebugLog('等待用户交互以启用音频播放', 'warning');
            return;
        }
        
        // 检查音频权限
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.tryResumeAudioContext();
            } catch (error) {
                this.addDebugLog(`音频权限检查失败: ${error.message}`, 'error');
                return;
            }
        }
        
        try {
            // 设置加载状态
            this.audioLoadingStates.set(recordId, 'loading');
            
            const downloadUrl = `https://nyw6vsud2p.ap-northeast-1.awsapprunner.com/api/v1/edit/downloadCreatedAudio?user_id=${userId}&record_id=${recordId}`;
            
            // 创建音频元素
            const audioElement = document.createElement('audio');
            audioElement.src = downloadUrl;
            audioElement.volume = 1.0;
            audioElement.loop = record.isLoop || false;
            
            // 设置音频属性以支持后台播放
            audioElement.preload = 'auto';
            audioElement.crossOrigin = 'anonymous';
            
            // 设置播放范围
            if (record.start_time && record.end_time) {
                audioElement.addEventListener('timeupdate', () => {
                    if (audioElement.currentTime >= record.end_time) {
                        if (record.isLoop) {
                            audioElement.currentTime = record.start_time;
                        } else {
                            this.stopSpecificAudio(recordId);
                        }
                    }
                });
                
                audioElement.addEventListener('loadedmetadata', () => {
                    audioElement.currentTime = record.start_time;
                });
            }
            
            // 音频结束时的处理
            audioElement.addEventListener('ended', () => {
                this.stopSpecificAudio(recordId);
            });
            
            // 音频错误处理
            audioElement.addEventListener('error', (error) => {
                console.error(`音频 ${recordId} 播放错误:`, error);
                const errorMessage = error.target.error?.message || '未知错误';
                this.addDebugLog(`音频 ${recordId} 播放错误: ${errorMessage}`, 'error');
                
                // 特殊处理权限错误
                if (errorMessage.includes('permission') || errorMessage.includes('user agent') || errorMessage.includes('platform')) {
                    this.addDebugLog('检测到权限错误，尝试重新获取音频权限', 'warning');
                    this.handleAudioPermissionError();
                }
                
                this.stopSpecificAudio(recordId);
            });
            
            // 音频加载成功处理
            audioElement.addEventListener('canplaythrough', () => {
                this.addDebugLog(`音频 ${recordId} 加载完成`, 'success');
            });
            
            // 直接尝试播放，不等待加载完成
            this.addDebugLog(`音频 ${recordId} 开始播放`);
            
            // 使用 Promise 包装播放操作
            const playPromise = audioElement.play();
            if (playPromise !== undefined) {
                await playPromise;
            }
            
            // 播放成功
            this.addDebugLog(`音频 ${recordId} 播放成功`, 'success');
            this.audioLoadingStates.set(recordId, 'loaded');
            this.audioPlayers.set(recordId, audioElement);
            this.playingRecords.add(recordId);
            this.isPlaying = true;
            
            // 设置"在范围内已播放"状态
            const rangeState = this.audioRangeStates.get(recordId);
            if (rangeState) {
                rangeState.hasPlayedInRange = true;
                this.audioRangeStates.set(recordId, rangeState);
            } else {
                const newState = {
                    inRange: true,
                    lastCheckTime: Date.now(),
                    hasPlayedInRange: true
                };
                this.audioRangeStates.set(recordId, newState);
            }
            
            this.updateUI();
            
        } catch (error) {
            console.error(`音频 ${recordId} 播放失败:`, error);
            this.addDebugLog(`音频 ${recordId} 播放失败: ${error.message}`, 'error');
            
            // 特殊处理权限错误
            if (error.message.includes('permission') || error.message.includes('user agent') || error.message.includes('platform')) {
                this.addDebugLog('检测到权限错误，尝试重新获取音频权限', 'warning');
                this.handleAudioPermissionError();
            }
            
            this.audioLoadingStates.set(recordId, 'error');
            this.playingRecords.delete(recordId);
            this.audioPlayers.delete(recordId);
        }
    }
    
    // 处理音频权限错误
    async handleAudioPermissionError() {
        this.audioPermissionGranted = false;
        
        // 尝试重新初始化音频上下文
        try {
            if (this.audioContext) {
                await this.audioContext.close();
            }
            this.audioContext = new (AudioContext || webkitAudioContext)();
            this.addDebugLog('音频上下文已重新初始化', 'info');
        } catch (error) {
            console.error('重新初始化音频上下文失败:', error);
            this.addDebugLog(`重新初始化音频上下文失败: ${error.message}`, 'error');
        }
        
        // 提示用户重新交互
        this.userInteracted = false;
        this.addDebugLog('请点击屏幕以重新启用音频播放', 'warning');
    }

    // 停止特定音频播放
    stopSpecificAudio(recordId) {
        if (!recordId) return;
        
        // 清理加载状态
        this.audioLoadingStates.delete(recordId);
        
        const audioElement = this.audioPlayers.get(recordId);
        if (audioElement) {
            try {
                // 暂停音频
                audioElement.pause();
                audioElement.currentTime = 0;
                
                // 从DOM中移除
                if (audioElement.parentNode) {
                    audioElement.parentNode.removeChild(audioElement);
                }
                
                this.addDebugLog(`音频 ${recordId} 已停止`);
                
            } catch (error) {
                console.error(`停止音频 ${recordId} 时出错:`, error);
            }
        }
        
        // 从管理器中移除
        this.playingRecords.delete(recordId);
        this.audioPlayers.delete(recordId);
        
        // 更新播放状态
        this.isPlaying = this.playingRecords.size > 0;
        this.updateUI();
    }

    // 停止所有音频播放
    stopAudio() {
        // 清理所有加载状态
        this.audioLoadingStates.clear();
        
        // 停止所有正在播放的音频
        const recordIds = Array.from(this.playingRecords);
        for (const recordId of recordIds) {
            this.stopSpecificAudio(recordId);
        }
        
        // 不重置已播放状态，保持用户的播放历史
        // 只有在停止追踪时才重置状态
        
        // 确保状态重置
        this.isPlaying = false;
        this.playingRecords.clear();
        
        this.addDebugLog('所有音频已停止', 'info');
        this.updateUI();
    }

    setData(data) {
        Object.assign(this, data);
        this.updateUI();
    }

    setLoading(loading) {
        this.isLoading = loading;
        this.updateUI();
    }

    updateUI() {
        // 更新基本信息
        if (this.itemDetail) {
            document.getElementById('work-title').textContent = this.itemDetail.title;
            document.getElementById('author-name').textContent = this.itemDetail.author;
            document.getElementById('creation-time').textContent = this.itemDetail.creationTime;
            document.getElementById('intro-text').textContent = this.itemDetail.description;
        }

        // 更新按钮文本，显示播放数量
        const playCount = this.playingRecords.size;
        if (playCount == 1){
            this.buttonText = `stop tracking\nplaying ${playCount} track`;
        } else if (playCount > 1){
            this.buttonText = `stop tracking\nplaying ${playCount} tracks`;
        } else if (this.isTracking) {
            this.buttonText = 'stop tracking';
        } else {
            this.buttonText = 'start tracking and playing';
        }

        // 更新按钮状态
        const buttonText = document.getElementById('button-text');
        if (buttonText) {
            buttonText.innerHTML = this.buttonText.replace(/\n/g, '<br>');
        }

        // 更新加载状态
        const loadingContainer = document.getElementById('loading-container');
        const map = document.getElementById('map');
        if (loadingContainer && map) {
            if (this.isLoading) {
                loadingContainer.style.display = 'flex';
                map.style.display = 'none';
            } else {
                loadingContainer.style.display = 'none';
                map.style.display = 'block';
            }
        }

        // 更新按钮状态
        const playButton = document.getElementById('play-button');
        if (playButton) {
            playButton.className = `button-section ${this.isPlaying || this.isTracking ? 'active' : ''} ${this.isTracking ? 'tracking' : ''} ${this.isPlaying ? 'playing' : ''}`;
        }

        // 更新进度条
        const progressBar = document.getElementById('progress-bar');
        if (progressBar) {
            progressBar.style.width = `${this.progress}%`;
        }

        // 更新调试信息（总是调用，内部会处理显示/隐藏）
        this.updateDebugInfo();
    }

    // 添加调试日志
    addDebugLog(message, type = 'info') {
        // 如果debug功能被禁用，直接返回
        if (!this.debugEnabled) return;
        
        const now = new Date();
        const timestamp = now.toLocaleTimeString();
        const logObject = {
            timestamp: timestamp,
            message: message,
            type: type,
            time: now.getTime() // 保存时间戳用于排序
        };
        
        // 添加到日志对象数组
        this.debugLogObjects.unshift(logObject);
        
        // 限制日志数量
        if (this.debugLogObjects.length > this.maxDebugLogs) {
            this.debugLogObjects = this.debugLogObjects.slice(0, this.maxDebugLogs);
        }
        
        // 更新格式化的日志字符串（用于向后兼容）
        this.debugLogs = this.debugLogObjects.map(log => `${log.timestamp}: ${log.message}`);
        
        // 立即更新调试信息
        this.updateDebugInfo();
        
        // Safari兼容：强制DOM更新
        setTimeout(() => {
            this.updateDebugInfo();
        }, 0);
    }

    // 更新调试信息
    updateDebugInfo() {
        const debugContent = document.getElementById('debug-content');
        if (!debugContent) return;

        // 构建调试信息
        let debugInfo = [];
        
        // 基本信息
        debugInfo.push(`位置: ${this.globalData?.currentLocation ? '已获取' : '未获取'}`);
        debugInfo.push(`追踪: ${this.isTracking ? '开启' : '关闭'}`);
        debugInfo.push(`播放: ${this.isPlaying ? '开启' : '关闭'}`);
        
        // 音频权限信息
        debugInfo.push(`音频权限: ${this.audioPermissionGranted ? '已获取' : '未获取'}`);
        debugInfo.push(`用户交互: ${this.userInteracted ? '是' : '否'}`);
        debugInfo.push(`后台播放: ${this.backgroundAudioEnabled ? '支持' : '不支持'}`);
        
        // 音频上下文状态
        if (this.audioContext) {
            debugInfo.push(`音频上下文: ${this.audioContext.state}`);
        }
        
        // 音频播放统计
        const playingCount = this.playingRecords.size;
        const playedCount = Array.from(this.audioRangeStates.values()).filter(state => state.hasPlayedInRange).length;
        let audioStatus = '';
        if (playingCount > 0 || playedCount > 0) {
            audioStatus = ` (播放中:${playingCount}, 已播放:${playedCount})`;
        }
        debugInfo.push(`音频状态${audioStatus}`);
        
        // 音频加载状态统计
        const loadingCount = Array.from(this.audioLoadingStates.values()).filter(state => state === 'loading').length;
        const errorCount = Array.from(this.audioLoadingStates.values()).filter(state => state === 'error').length;
        if (loadingCount > 0 || errorCount > 0) {
            debugInfo.push(`加载状态 (加载中:${loadingCount}, 错误:${errorCount})`);
        }
        
        // 位置信息
        if (this.globalData?.currentLocation) {
            const loc = this.globalData.currentLocation;
            debugInfo.push(`坐标: ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}`);
            debugInfo.push(`精度: ${loc.accuracy ? loc.accuracy.toFixed(1) + 'm' : '未知'}`);
        }
        
        // 地图信息
        if (this.map) {
            const center = this.map.getCenter();
            debugInfo.push(`地图中心: ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`);
            debugInfo.push(`缩放级别: ${this.map.getZoom()}`);
        }
        
        // 最近日志
        if (this.debugLogs.length > 0) {
            debugInfo.push('--- 最近日志 ---');
            this.debugLogs.slice(-3).forEach(log => {
                debugInfo.push(log);
            });
        }
        
        // 更新显示
        debugContent.innerHTML = debugInfo.map(info => `<div class="debug-item">${info}</div>`).join('');
    }

    initMap(currentLocation, locations) {
        let mapElement = document.getElementById('map');
        if (!mapElement) {
            console.error('Map element not found');
            return;
        }

        // 彻底销毁旧地图，避免DOM冲突
        if (this.map) {
            this.map.off(); // 移除所有事件
            this.map.remove(); // 彻底销毁地图实例和DOM
            this.map = null;
        }
        this.leafletMarkers = [];

        // 计算中心点和缩放级别
        let center = [30, 120]; // 默认中国东部
        let zoomLevel = this.scale;
        
        // 收集所有点用于计算（用户当前位置 + 作品markers位置）
        const allPoints = [];
        
        // 添加作品markers位置
        if (locations && locations.length > 0) {
            locations.forEach(marker => {
                allPoints.push({
                    latitude: parseFloat(marker.latitude),
                    longitude: parseFloat(marker.longitude)
                });
            });
        }
        
        // 添加用户当前位置
        if (currentLocation) {
            allPoints.push({
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude
            });
        }
        
        // 计算合适的缩放级别
        if (allPoints.length > 0) {
            zoomLevel = this.calculateOptimalScale(allPoints);
            // 计算中心点
            const avgLat = allPoints.reduce((sum, point) => sum + point.latitude, 0) / allPoints.length;
            const avgLng = allPoints.reduce((sum, point) => sum + point.longitude, 0) / allPoints.length;
            center = [avgLat, avgLng];
        }

        // 初始化Leaflet地图
        this.map = L.map(mapElement).setView(center, zoomLevel);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(this.map);
        
        // 强制刷新地图视图，确保中心点正确显示
        setTimeout(() => {
            this.map.invalidateSize();
            this.map.setView(center, zoomLevel);
        }, 50);

        // 添加路线点标记
        if (locations && locations.length > 0) {
            locations.forEach((marker, index) => {
                try {
                    const leafletMarker = L.marker([
                        parseFloat(marker.latitude),
                        parseFloat(marker.longitude)
                    ], {
                        title: marker.marker_name || marker.no || (index + 1).toString()
                    }).addTo(this.map);
                    
                    // 确保markerNumber是有效的字符串
                    let markerNumber = '';
                    if (marker.no !== null && marker.no !== undefined && marker.no !== '') {
                        markerNumber = String(marker.no);
                    } else {
                        markerNumber = String(index + 1);
                    }
                    
                    // 创建tooltip内容
                    const tooltipContent = document.createElement('div');
                    tooltipContent.textContent = markerNumber;
                    tooltipContent.style.cssText = 'font-weight: bold; color: #333;';
                    
                    leafletMarker.bindTooltip(tooltipContent, {permanent: true, direction: 'top'});
                    this.leafletMarkers.push(leafletMarker);
                } catch (error) {
                    console.error('添加标记失败:', error, marker);
                }
            });
        }

        // 添加当前位置标记
        if (currentLocation) {
            try {
                this.userMarker = L.circleMarker([
                    currentLocation.latitude,
                    currentLocation.longitude
                ], {
                    radius: 12,
                    color: '#4CAF50',
                    fillColor: '#4CAF50',
                    fillOpacity: 1,
                    weight: 2
                }).addTo(this.map);
                
                // 创建用户标记的tooltip内容
                const userTooltipContent = document.createElement('div');
                userTooltipContent.textContent = '你';
                userTooltipContent.style.cssText = 'font-weight: bold; color: #4CAF50;';
                
                this.userMarker.bindTooltip(userTooltipContent, {permanent: true, direction: 'right'});
            } catch (error) {
                console.error('添加当前位置标记失败:', error);
            }
        }

        // 使用计算出的缩放级别和中心点，不再使用fitBounds
    }

    calculateOptimalScale(points) {
        if (points.length === 0) return 14;
        
        // 计算所有点的边界
        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;
        
        points.forEach(point => {
            const lat = parseFloat(point.latitude || point.lat);
            const lng = parseFloat(point.longitude || point.lng);
            if (!isNaN(lat) && !isNaN(lng)) {
                minLat = Math.min(minLat, lat);
                maxLat = Math.max(maxLat, lat);
                minLng = Math.min(minLng, lng);
                maxLng = Math.max(maxLng, lng);
            }
        });
        
        if (minLat === Infinity || maxLat === -Infinity) return 14;
        
        // 计算合适的缩放级别
        const latDiff = Math.abs(maxLat - minLat);
        const lngDiff = Math.abs(maxLng - minLng);
        const maxDiff = Math.max(latDiff, lngDiff);
        
        let zoomLevel = 14;
        if (maxDiff > 0.1) zoomLevel = 10;
        else if (maxDiff > 0.05) zoomLevel = 12;
        else if (maxDiff > 0.01) zoomLevel = 14;
        else if (maxDiff > 0.005) zoomLevel = 16;
        else zoomLevel = 18;
        
        return zoomLevel;
    }

    initAudioManager() {
        this.audioManager = document.getElementById('audio-player');
        if (this.audioManager) {
            this.audioManager.addEventListener('ended', () => {
                this.isPlaying = false;
                this.updateUI();
            });
        }
    }

    handlePlayAudio() {
        if (this.isButtonDisabled) return;

        if (!this.isTracking) {
            this.startTracking();
        } else {
            this.stopTracking();
        }
    }

    startTracking() {
        this.isTracking = true;
        this.buttonText = 'stop tracking';
        this.updateUI();
        
        this.addDebugLog('开始追踪', 'info');
        window.app.showToast('开始追踪，请移动到音频点附近');
        
        // 立即检查当前位置，不受防抖机制影响
        const currentLocation = window.app.globalData.currentLocation;
        if (currentLocation) {
            this.addDebugLog('立即检查当前位置');
            // 直接调用检查方法，跳过防抖
            this.checkProximityToMarkers(currentLocation);
        } else {
            this.addDebugLog('暂无位置数据，等待位置更新');
        }
    }

    // 停止追踪
    stopTracking() {
        this.isTracking = false;
        this.stopAudio();
        
        // 重置音频范围状态
        this.audioRangeStates.clear();
        
        // 清理位置更新回调
        window.app.setLocationCallback(null);
        
        // 清理音频权限管理的事件监听器
        if (this.visibilityChangeHandler) {
            document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
            this.visibilityChangeHandler = null;
        }
        
        // 清理音频上下文
        if (this.audioContext) {
            this.audioContext.close().catch(error => {
                console.error('关闭音频上下文失败:', error);
            });
            this.audioContext = null;
        }
        
        this.addDebugLog('追踪已停止', 'info');
        this.updateUI();
    }

    goBack() {
        // console.log('返回首页，清理资源');
        
        // 停止追踪
        if (this.isTracking) {
            this.stopTracking();
        }
        
        // 清理防抖定时器
        if (this.proximityCheckTimeout) {
            clearTimeout(this.proximityCheckTimeout);
            this.proximityCheckTimeout = null;
        }
        
        // 清理所有音频资源
        this.stopAudio();
        
        // 清理地图资源
        if (this.map) {
            this.map.off(); // 移除所有事件
            this.map.remove(); // 彻底销毁地图实例和DOM
            this.map = null;
        }
        this.leafletMarkers = [];
        this.userMarker = null;
        
        // 返回首页
        window.location.href = 'index.html';
    }

    // 位置更新处理
    onLocationUpdate(location) {
        if (!location) return;
        
        // 如果页面还没有初始化，先进行完整初始化
        if (!this.map && !this.isInitializing) {
            this.isInitializing = true; // 设置初始化标志
            // 从URL参数获取userName
            const urlParams = new URLSearchParams(window.location.search);
            const userName = urlParams.get('userName');
            this.initializePageData(this.userId, location, null, userName);
            return;
        }
        
        // 更新用户位置标记
        this.updateUserMarker(location);
        
        // 更新调试信息（总是调用，内部会处理显示/隐藏）
        this.updateDebugInfo();
        
        // 如果正在追踪，立即执行一次位置检查，防止防抖导致首次不触发
        if (this.isTracking) {
            this.checkProximityToMarkers(location);
        }
    }

    // 防抖的位置检查
    debouncedProximityCheck(location) {
        const now = Date.now();
        
        // 清除之前的定时器
        if (this.proximityCheckTimeout) {
            clearTimeout(this.proximityCheckTimeout);
        }
        
        // 如果距离上次检查时间太短，延迟执行
        if (now - this.lastProximityCheck < this.proximityCheckInterval) {
            this.proximityCheckTimeout = setTimeout(() => {
                this.checkProximityToMarkers(location);
                this.lastProximityCheck = Date.now();
            }, this.proximityCheckInterval - (now - this.lastProximityCheck));
        } else {
            // 直接执行
            this.checkProximityToMarkers(location);
            this.lastProximityCheck = now;
        }
    }

    // 更新用户位置标记
    updateUserMarker(location) {
        if (!this.map) {
            // console.log('Map not available for user marker update');
            return;
        }
        
        // console.log('Updating user marker with location:', location);
        
        // 移除旧的用户标记
        if (this.userMarker) {
            this.map.removeLayer(this.userMarker);
        }
        
        // 添加新的用户标记
        try {
            this.userMarker = L.circleMarker([
                location.latitude,
                location.longitude
            ], {
                radius: 12,
                color: '#4CAF50',
                fillColor: '#4CAF50',
                fillOpacity: 1,
                weight: 2
            }).addTo(this.map);
            
            // 创建用户标记的tooltip内容
            const userTooltipContent = document.createElement('div');
            userTooltipContent.textContent = '你';
            userTooltipContent.style.cssText = 'font-weight: bold; color: #4CAF50;';
            
            this.userMarker.bindTooltip(userTooltipContent, {permanent: true, direction: 'right'});
            // console.log('User marker updated successfully');
        } catch (error) {
            console.error('更新用户位置标记失败:', error);
        }
    }

    // 新增：查找50m范围内的点
    findNearbyMarkers(userLocation, range = 50) {
        const storedData = this.getDataFromLocalStorage(this.userId);
        if (!storedData || !storedData.locations) return [];
        return storedData.locations
            .map((marker, idx) => {
                const distance = window.utils.calculateDistance(
                    userLocation.latitude,
                    userLocation.longitude,
                    parseFloat(marker.latitude),
                    parseFloat(marker.longitude)
                );
                return { marker, distance, idx };
            })
            .filter(item => item.distance <= range)
            .sort((a, b) => a.distance - b.distance);
    }

    // 优化后的音频播放判断逻辑（支持多音频同时播放）
    async checkProximityToMarkers(userLocation) {
        // 如果不在追踪状态，直接返回
        if (!this.isTracking) {
            return;
        }
        
        this.addDebugLog('开始位置检查');
        
                const storedData = this.getDataFromLocalStorage(this.userId);
        if (!storedData || !storedData.locations) {
            return;
        }

        const nearby = this.findNearbyMarkers(userLocation, 50);
        
        const playableRecords = [];
        
        // 检查所有附近的marker
        for (const { marker, distance, idx } of nearby) {
            const key = `${marker.latitude}_${marker.longitude}`;
            const audioData = storedData.records[key];
            if (!audioData || !audioData.records.length) {
                continue;
            }
            
            // 检查每条record
            for (const record of audioData.records) {
                if (!record.isPlay) {
                    continue;
                }
                
                // 检查是否在播放范围内（纯检查，不更新状态）
                const isInRange = this.isAudioInRange(record, userLocation);
                if (isInRange) {
                    // 更新状态
                    this.updateAudioRangeState(record.record_id, true);
                    playableRecords.push({ record, distance, idx });
                } else {
                    // 不在范围内，更新状态
                    this.updateAudioRangeState(record.record_id, false);
                }
            }
        }
        
        // 播放所有符合条件的音频
        const playPromises = [];
        for (const { record } of playableRecords) {
            
            // 检查是否已经在播放
            if (this.playingRecords.has(record.record_id)) {
                this.addDebugLog(`音频 ${record.record_id} 已在播放中，跳过`);
                continue;
            }
            
            // 检查是否在范围内已播放过（避免重复播放）
            const rangeState = this.audioRangeStates.get(record.record_id);
            if (rangeState && rangeState.hasPlayedInRange) {
                this.addDebugLog(`音频 ${record.record_id} 在范围内已播放过，跳过`);
                continue;
            }
            
            try {
                const playPromise = this.playAudio(record, this.userId).catch(error => {
                    this.addDebugLog(`音频 ${record.record_id} 播放失败: ${error.message}`);
                });
                playPromises.push(playPromise);
            } catch (error) {
                this.addDebugLog(`准备播放音频 ${record.record_id} 失败: ${error.message}`);
            }
        }
        
        // 等待所有播放操作完成，但不阻塞
        if (playPromises.length > 0) {
            Promise.allSettled(playPromises);
        }
        
        // 停止不在范围内的音频（使用防抖机制）
        const currentPlayingIds = Array.from(this.playingRecords);
        for (const recordId of currentPlayingIds) {
            if (this.shouldStopAudio(recordId, playableRecords)) {
                this.stopSpecificAudio(recordId);
            }
        }
    }

    // 检查音频是否在播放范围内（纯检查，不更新状态）
    isAudioInRange(record, userLocation) {
        const recordId = record.record_id;
        const storedData = this.getDataFromLocalStorage(this.userId);
        if (!storedData || !storedData.locations) return false;
        
        // 找到对应的marker
        const marker = storedData.locations.find(m => {
            const key = `${m.latitude}_${m.longitude}`;
            const audioData = storedData.records[key];
            return audioData && audioData.records.some(r => r.record_id === recordId);
        });
        
        if (!marker) return false;
        
        // 计算距离
        const distance = window.utils.calculateDistance(
            userLocation.latitude,
            userLocation.longitude,
            parseFloat(marker.latitude),
            parseFloat(marker.longitude)
        );
        
        // 检查是否在播放范围内
        const outerRadius = record.outer_radius;
        const innerRadius = record.inner_radius;
        const currentlyInRange = distance <= outerRadius && distance >= innerRadius;
        
        return currentlyInRange;
    }

    // 更新音频范围状态（单独的方法）
    updateAudioRangeState(recordId, isNowInRange) {
        const currentState = this.audioRangeStates.get(recordId) || {
            inRange: false,
            lastCheckTime: 0,
            hasPlayedInRange: false
        };
        
        const wasInRange = currentState.inRange;
        const wasPlayedInRange = currentState.hasPlayedInRange;
        
        // 更新状态
        if (isNowInRange && !wasInRange) {
            // 新进入范围
            currentState.inRange = true;
            currentState.lastCheckTime = Date.now();
            // 进入范围时重置播放状态，允许播放
            currentState.hasPlayedInRange = false;
            this.addDebugLog(`音频 ${recordId} 进入范围，重置播放状态`, 'info');
        } else if (isNowInRange && wasInRange) {
            // 持续在范围内，保持现有状态
            currentState.lastCheckTime = Date.now();
            // 不修改 hasPlayedInRange，保持之前的状态
        } else if (!isNowInRange && wasInRange) {
            // 离开范围，更新状态
            currentState.inRange = false;
            currentState.lastCheckTime = Date.now();
            // 离开范围时保持播放状态，不重置
            this.addDebugLog(`音频 ${recordId} 离开范围，保持播放状态 (wasPlayed: ${wasPlayedInRange})`, 'info');
        }
        
        this.audioRangeStates.set(recordId, currentState);
    }

    // 检查音频是否应该停止播放（立即响应，无防抖）
    shouldStopAudio(recordId, playableRecords) {
        // 获取当前状态
        const currentState = this.audioRangeStates.get(recordId);
        if (!currentState) return true; // 如果没有状态记录，直接停止

        // 检查是否在playableRecords中（当前检查在范围内）
        const isStillInRange = playableRecords.some(({ record }) => record.record_id === recordId);
        if (isStillInRange) {
            // 在范围内，不停止播放
            return false;
        }

        // 不在playableRecords中，检查是否真的在范围内
        const currentLocation = window.app.globalData.currentLocation;
        if (currentLocation) {
            const storedData = this.getDataFromLocalStorage(this.userId);
            if (storedData && storedData.locations) {
                for (const location of storedData.locations) {
                    const key = `${location.latitude}_${location.longitude}`;
                    const audioData = storedData.records[key];
                    if (audioData && audioData.records) {
                        for (const record of audioData.records) {
                            if (record.record_id === recordId && record.isPlay) {
                                const isActuallyInRange = this.isAudioInRange(record, currentLocation);
                                if (isActuallyInRange) {
                                    return false;
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
        // 只要不在范围内，立即停止
        return true;
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.detailPage = new DetailPage();
    
    // 从URL参数获取数据并初始化
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    const userId = urlParams.get('userId');
    const userName = urlParams.get('userName');
    
    if (id && userId && userName) {
        window.detailPage.init(id, userId, userName);
    } else {
        // console.error('Missing required parameters');
        window.app.showToast('参数错误');
        // 如果没有必要参数，返回首页
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 2000);
    }

    // 隐秘Debug切换按钮逻辑
    const debugToggleBtn = document.getElementById('debug-toggle-btn');
    if (debugToggleBtn && window.detailPage) {
        debugToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const page = window.detailPage;
            page.debugEnabled = !page.debugEnabled;
            page.updateUI();
            // console.log('Debug状态切换为:', page.debugEnabled ? '开启' : '关闭');
        });
    }
});