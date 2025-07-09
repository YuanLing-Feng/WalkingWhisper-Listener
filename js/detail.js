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
        this.audioCache = new Map(); // 音频缓存
        this.currentPlayingRecord = null; // 当前播放的音频记录
        this.userId = null; // 用户ID
        this.storedData = null; // 存储的数据
        this.isInitializing = false; // 防止重复初始化的标志
        
        // 多音频播放管理
        this.audioPlayers = new Map(); // 存储所有音频播放器 {record_id: audioElement}
        this.playingRecords = new Set(); // 当前正在播放的record_id集合
        this.audioLoadingStates = new Map(); // 音频加载状态 {record_id: 'loading'|'loaded'|'error'}
        this.audioPlayPromises = new Map(); // 防止重复播放的Promise {record_id: Promise}
        this.audioPlayHistory = new Map(); // 音频播放历史 {record_id: {lastPlayTime, hasPlayedOnce}}
        
        // 音频范围状态跟踪（重新设计）
        this.audioRangeStates = new Map(); // 音频范围状态 {record_id: {inRange: boolean, lastCheckTime: number, hasPlayedInRange: boolean}}
        this.rangeDebounceTime = 500; // 500ms防抖时间（小于GPS调用间隔）
        
        // 防抖机制
        this.proximityCheckTimeout = null;
        this.lastProximityCheck = 0;
        this.proximityCheckInterval = 1000; // 1秒间隔追踪距离变化
        
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

    // 播放音频文件（支持多音频同时播放）
    async playAudio(record, userId) {
        if (!record.record_id) return;
        
        const recordId = record.record_id;
        
        // 检查是否正在加载相同的音频
        if (this.audioPlayPromises.has(recordId)) {
            try {
                await this.audioPlayPromises.get(recordId);
            } catch (error) {
                console.warn(`等待音频 ${recordId} 加载失败:`, error);
            }
            return;
        }
        
        // 创建播放Promise来防止重复播放
        const playPromise = this._playAudioInternal(record, userId);
        this.audioPlayPromises.set(recordId, playPromise);
        
        try {
            await playPromise;
            
            // 设置"在范围内已播放"状态
            const rangeState = this.audioRangeStates.get(recordId);
            if (rangeState) {
                rangeState.hasPlayedInRange = true;
                this.audioRangeStates.set(recordId, rangeState);
            } else {
                // 如果没有状态记录，创建一个
                const newState = {
                    inRange: true,
                    lastCheckTime: Date.now(),
                    hasPlayedInRange: true
                };
                this.audioRangeStates.set(recordId, newState);
            }
            
            // 记录播放历史
            this.audioPlayHistory.set(recordId, {
                lastPlayTime: Date.now(),
                hasPlayedOnce: true
            });
            
        } catch (error) {
            console.error(`音频 ${recordId} 播放失败:`, error);
            // 清理错误状态
            this.audioLoadingStates.set(recordId, 'error');
            this.playingRecords.delete(recordId);
            this.audioPlayers.delete(recordId);
            
            // 移除错误提示，静默失败
            // window.app.showToast(`音频播放失败: ${error.message || '未知错误'}`);
        } finally {
            // 清理Promise引用
            this.audioPlayPromises.delete(recordId);
        }
    }

    // 内部播放方法
    async _playAudioInternal(record, userId) {
        const recordId = record.record_id;
        
        try {
            // 设置加载状态
            this.audioLoadingStates.set(recordId, 'loading');
            
            const downloadUrl = `https://nyw6vsud2p.ap-northeast-1.awsapprunner.com/api/v1/edit/downloadCreatedAudio?user_id=${userId}&record_id=${recordId}`;
            
            // 创建新的音频元素
            const audioElement = document.createElement('audio');
            audioElement.preload = 'metadata'; // 只预加载元数据，不预加载整个文件
            audioElement.crossOrigin = 'anonymous';
            
            // 设置音频属性
            audioElement.volume = 1.0;
            audioElement.loop = record.isLoop || false;
            
            // 检查缓存
            if (this.audioCache.has(recordId)) {
                audioElement.src = this.audioCache.get(recordId);
            } else {
                audioElement.src = downloadUrl;
                this.audioCache.set(recordId, downloadUrl);
            }
            
            // 设置播放范围
            if (record.start_time && record.end_time) {
                const timeUpdateHandler = () => {
                    if (audioElement.currentTime >= record.end_time) {
                        if (record.isLoop) {
                            audioElement.currentTime = record.start_time;
                        } else {
                            this.stopSpecificAudio(recordId);
                        }
                    }
                };
                
                const loadedMetadataHandler = () => {
                    audioElement.currentTime = record.start_time;
                };
                
                audioElement.addEventListener('timeupdate', timeUpdateHandler);
                audioElement.addEventListener('loadedmetadata', loadedMetadataHandler);
                
                // 存储事件处理器以便后续清理
                audioElement._timeUpdateHandler = timeUpdateHandler;
                audioElement._loadedMetadataHandler = loadedMetadataHandler;
            }
            
            // 音频结束时的处理
            audioElement.addEventListener('ended', () => {
                this.stopSpecificAudio(recordId);
            });
            
            // 音频错误处理
            audioElement.addEventListener('error', (error) => {
                console.error(`音频 ${recordId} 播放错误:`, error);
                this.stopSpecificAudio(recordId);
            });
            
            // 直接尝试播放，不等待完全加载
            try {
                await audioElement.play();
            } catch (playError) {
                // 如果直接播放失败，尝试等待加载后播放

                
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error(`音频 ${recordId} 加载超时`));
                    }, 15000); // 增加到15秒超时
                    
                    const handleCanPlay = async () => {
                        clearTimeout(timeout);
                        audioElement.removeEventListener('canplay', handleCanPlay);
                        audioElement.removeEventListener('error', handleError);
                        
                        try {
                            await audioElement.play();
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    };
                    
                    const handleError = (error) => {
                        clearTimeout(timeout);
                        audioElement.removeEventListener('canplay', handleCanPlay);
                        audioElement.removeEventListener('error', handleError);
                        reject(new Error(`音频 ${recordId} 加载失败: ${error.message || '未知错误'}`));
                    };
                    
                    audioElement.addEventListener('canplay', handleCanPlay);
                    audioElement.addEventListener('error', handleError);
                });
            }
            
            // 设置加载完成状态
            this.audioLoadingStates.set(recordId, 'loaded');
            
            // 记录正在播放的音频
            this.audioPlayers.set(recordId, audioElement);
            this.playingRecords.add(recordId);
            this.isPlaying = true;
            
            this.updateUI();
            

            
        } catch (error) {
            console.error(`音频 ${recordId} 播放失败:`, error);
            this.audioLoadingStates.set(recordId, 'error');
            
            // 清理可能创建的音频元素
            const audioElement = this.audioPlayers.get(recordId);
            if (audioElement) {
                this._cleanupAudioElement(audioElement, recordId);
            }
            
            // 移除错误提示，静默失败
            // window.app.showToast(`音频播放失败: ${error.message || '未知错误'}`);
            throw error;
        }
    }

    // 清理音频元素的辅助方法
    _cleanupAudioElement(audioElement, recordId) {
        try {
            // 暂停音频
            audioElement.pause();
            audioElement.currentTime = 0;
            
            // 清除事件监听器
            if (audioElement._timeUpdateHandler) {
                audioElement.removeEventListener('timeupdate', audioElement._timeUpdateHandler);
            }
            if (audioElement._loadedMetadataHandler) {
                audioElement.removeEventListener('loadedmetadata', audioElement._loadedMetadataHandler);
            }
            
            // 从DOM中移除
            if (audioElement.parentNode) {
                audioElement.parentNode.removeChild(audioElement);
            }
        } catch (error) {
            console.warn(`清理音频元素 ${recordId} 时出错:`, error);
        }
    }

    // 停止特定音频播放
    stopSpecificAudio(recordId) {
        if (!recordId) return;
        
        // 清理加载Promise
        if (this.audioPlayPromises.has(recordId)) {
            this.audioPlayPromises.delete(recordId);
        }
        
        // 清理加载状态
        this.audioLoadingStates.delete(recordId);
        
        // 清理播放历史，这样重新进入范围时可以重新播放
        this.audioPlayHistory.delete(recordId);
        
        // 不清理音频范围状态，保持状态以便正确判断是否已经播放过
        // this.audioRangeStates.delete(recordId);
        
        const audioElement = this.audioPlayers.get(recordId);
        if (audioElement) {
            try {
                // 使用辅助方法清理音频元素
                this._cleanupAudioElement(audioElement, recordId);
                
                // 从管理器中移除
                this.audioPlayers.delete(recordId);
                this.playingRecords.delete(recordId);
                

                
            } catch (error) {
                console.error(`停止音频 ${recordId} 时出错:`, error);
                // 即使出错也要从管理器中移除
                this.audioPlayers.delete(recordId);
                this.playingRecords.delete(recordId);
            }
        } else {
            // 如果找不到音频元素，也要从管理器中移除
            this.playingRecords.delete(recordId);
        }
        
        // 更新播放状态
        this.isPlaying = this.playingRecords.size > 0;
        this.updateUI();
    }

    // 停止所有音频播放
    stopAudio() {
        // 清理所有加载Promise
        this.audioPlayPromises.clear();
        
        // 清理所有加载状态
        this.audioLoadingStates.clear();
        
        // 停止所有正在播放的音频
        const recordIds = Array.from(this.playingRecords);
        for (const recordId of recordIds) {
            this.stopSpecificAudio(recordId);
        }
        
        // 重置所有音频的播放状态，允许用户重新播放
        this.audioRangeStates.forEach((state, recordId) => {
            if (state.inRange) {
                state.hasPlayedInRange = false;
            }
        });
        
        // 确保状态重置
        this.isPlaying = false;
        this.playingRecords.clear();
        this.audioPlayers.clear();
        
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

        // 更新调试信息
        this.updateDebugInfo();
    }

    // 更新调试信息
    updateDebugInfo() {
        const debugContent = document.getElementById('debug-content');
        if (!debugContent) return;

        const currentLocation = window.app.globalData.currentLocation;
        if (!currentLocation) {
            debugContent.innerHTML = '<div class="debug-item no-data">等待位置数据...</div>';
            return;
        }

        const storedData = this.getDataFromLocalStorage(this.userId);
        if (!storedData || !storedData.locations) {
            debugContent.innerHTML = '<div class="debug-item no-data">暂无位置数据</div>';
            return;
        }

        // 查找50m内的所有点
        const nearby = this.findNearbyMarkers(currentLocation, 50);
        
        if (nearby.length === 0) {
            debugContent.innerHTML = '<div class="debug-item no-data">50m内无音频点</div>';
            return;
        }

        // 生成调试信息
        let debugHTML = '';
        nearby.forEach(({ marker, distance, idx }) => {
            const key = `${marker.latitude}_${marker.longitude}`;
            const audioData = storedData.records[key];
            const hasAudio = audioData && audioData.records && audioData.records.length > 0;
            
            debugHTML += `
                <div class="debug-item distance">
                    点${idx + 1}: ${distance.toFixed(1)}m ${hasAudio ? '✓' : '✗'}
                </div>
            `;
        });

        // 添加当前播放状态
        if (this.playingRecords.size > 0) {
            debugHTML += `<div class="debug-item">正在播放: ${this.playingRecords.size} 个音频</div>`;
        }

        debugContent.innerHTML = debugHTML;
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
        
        // console.log('Tracking started, isTracking:', this.isTracking);
        window.app.showToast('开始追踪，请移动到音频点附近');
        
        // 立即检查当前位置，不受防抖机制影响
        const currentLocation = window.app.globalData.currentLocation;
        if (currentLocation) {
            // console.log('Immediately checking current location for tracking');
            // 直接调用检查方法，跳过防抖
            this.checkProximityToMarkers(currentLocation);
        } else {
            // console.log('No current location available for immediate check');
        }
    }

    stopTracking() {
        // console.log('停止追踪');
        this.isTracking = false;
        this.buttonText = 'start tracking and playing';
        this.progress = 0;
        
        // 清理防抖定时器
        if (this.proximityCheckTimeout) {
            clearTimeout(this.proximityCheckTimeout);
            this.proximityCheckTimeout = null;
        }
        this.lastProximityCheck = 0;
        
        // 停止所有音频播放
        this.stopAudio();
        
        // 清理播放历史，这样重新开始追踪时可以重新播放
        this.audioPlayHistory.clear();
        
        // 清理音频范围状态
        this.audioRangeStates.clear();
        
        // 确保状态重置
        this.isPlaying = false;
        this.isButtonDisabled = false;
        
        this.updateUI();
        
        window.app.showToast('已停止追踪');
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
        
        // 清理缓存
        this.audioCache.clear();
        
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
        
        // 更新调试信息
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
            // console.log('不在追踪状态，跳过位置检查');
            return;
        }
        
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
                continue;
            }
            
            // 检查在范围内是否已经播放过
            const rangeState = this.audioRangeStates.get(record.record_id);
            if (rangeState && rangeState.hasPlayedInRange) {
                continue;
            }
            
            try {
                const playPromise = this.playAudio(record, this.userId).catch(error => {
                    console.warn(`音频 ${record.record_id} 播放失败，跳过:`, error);
                });
                playPromises.push(playPromise);
            } catch (error) {
                console.error(`准备播放音频 ${record.record_id} 失败:`, error);
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
        
        // 更新状态
        if (isNowInRange && !wasInRange) {
            // 新进入范围
            currentState.inRange = true;
            currentState.lastCheckTime = Date.now();
            currentState.hasPlayedInRange = false; // 进入范围时重置为未播放
        } else if (isNowInRange && wasInRange) {
            // 持续在范围内，保持现有状态
            currentState.lastCheckTime = Date.now();
            // 不修改 hasPlayedInRange，保持之前的状态
        } else if (!isNowInRange && wasInRange) {
            // 离开范围，更新状态
            currentState.inRange = false;
            currentState.lastCheckTime = Date.now();
            currentState.hasPlayedInRange = false; // 离开范围时重置播放状态
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
});