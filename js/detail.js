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
        this.buttonText = 'download audio and start tracking';
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
        console.log('Detail page init:', id, userId, userName);
        this.userId = userId;
        
        // 设置位置更新回调
        window.app.setLocationCallback((location) => {
            console.log('Detail page location callback triggered:', location);
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
            console.log('LocationMarkers API Response:', res);

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
                    console.log('API response for marker:', marker.latitude, marker.longitude, 'data:', res.data);
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
                        console.log('Filtered playable records with radius:', records);
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
        
        // 检查是否已经在播放相同的音频
        if (this.playingRecords.has(record.record_id)) {
            console.log(`音频 ${record.record_id} 已在播放中`);
            return;
        }
        
        try {
            const downloadUrl = `https://nyw6vsud2p.ap-northeast-1.awsapprunner.com/api/v1/edit/downloadCreatedAudio?user_id=${userId}&record_id=${record.record_id}`;
            
            // 创建新的音频元素
            const audioElement = document.createElement('audio');
            audioElement.preload = 'auto';
            
            // 检查缓存
            if (this.audioCache.has(record.record_id)) {
                audioElement.src = this.audioCache.get(record.record_id);
            } else {
                audioElement.src = downloadUrl;
                this.audioCache.set(record.record_id, downloadUrl);
            }
            
            // 设置播放属性
            audioElement.loop = record.isLoop || false;
            
            // 设置播放范围
            if (record.start_time && record.end_time) {
                const timeUpdateHandler = () => {
                    if (audioElement.currentTime >= record.end_time) {
                        if (record.isLoop) {
                            audioElement.currentTime = record.start_time;
                        } else {
                            this.stopSpecificAudio(record.record_id);
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
                this.stopSpecificAudio(record.record_id);
            });
            
            // 开始播放
            await audioElement.play();
            
            // 记录正在播放的音频
            this.audioPlayers.set(record.record_id, audioElement);
            this.playingRecords.add(record.record_id);
            this.isPlaying = true;
            
            this.updateUI();
            
            console.log(`开始播放音频: ${record.record_id}, 循环: ${record.isLoop}, 当前播放数量: ${this.playingRecords.size}`);
            
        } catch (error) {
            console.error('音频播放失败:', error);
            window.app.showToast('音频播放失败');
        }
    }

    // 停止特定音频播放
    stopSpecificAudio(recordId) {
        const audioElement = this.audioPlayers.get(recordId);
        if (audioElement) {
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
            
            // 从管理器中移除
            this.audioPlayers.delete(recordId);
            this.playingRecords.delete(recordId);
            
            console.log(`停止播放音频: ${recordId}, 剩余播放数量: ${this.playingRecords.size}`);
            
            // 更新播放状态
            this.isPlaying = this.playingRecords.size > 0;
            this.updateUI();
        }
    }

    // 停止所有音频播放
    stopAudio() {
        // 停止所有正在播放的音频
        for (const recordId of this.playingRecords) {
            this.stopSpecificAudio(recordId);
        }
        
        this.isPlaying = false;
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
        if (playCount > 0) {
            this.buttonText = `stop tracking (${playCount} 音频播放中)`;
        } else if (this.isTracking) {
            this.buttonText = 'stop tracking';
        } else {
            this.buttonText = 'download audio and start tracking';
        }

        // 更新按钮状态
        const buttonText = document.getElementById('button-text');
        if (buttonText) {
            buttonText.textContent = this.buttonText;
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
        
        console.log('Tracking started, isTracking:', this.isTracking);
        window.app.showToast('开始追踪，请移动到音频点附近');
        
        // 立即检查当前位置
        const currentLocation = window.app.globalData.currentLocation;
        if (currentLocation) {
            console.log('Immediately checking current location for tracking');
            this.checkProximityToMarkers(currentLocation);
        } else {
            console.log('No current location available for immediate check');
        }
    }

    stopTracking() {
        this.isTracking = false;
        this.buttonText = 'download audio and start tracking';
        this.progress = 0;
        
        // 停止所有音频播放
        this.stopAudio();
        
        this.updateUI();
        
        window.app.showToast('已停止追踪');
    }

    goBack() {
        // 停止追踪
        if (this.isTracking) {
            this.stopTracking();
        }
        
        // 清理地图资源
        if (this.map) {
            this.map.remove();
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
        
        console.log('Location update received, isTracking:', this.isTracking, 'location:', location);
        
        // 如果页面还没有初始化，先进行完整初始化
        if (!this.map && !this.isInitializing) {
            console.log('Page not initialized yet, performing full initialization with location');
            this.isInitializing = true; // 设置初始化标志
            // 从URL参数获取userName
            const urlParams = new URLSearchParams(window.location.search);
            const userName = urlParams.get('userName');
            this.initializePageData(this.userId, location, null, userName);
            return;
        }
        
        // 更新用户位置标记
        this.updateUserMarker(location);
        
        // 如果正在追踪，可以在这里添加距离检测逻辑
        if (this.isTracking) {
            console.log('Tracking is active, checking proximity to markers');
            this.checkProximityToMarkers(location);
        } else {
            console.log('Tracking is not active, skipping proximity check');
        }
    }

    // 更新用户位置标记
    updateUserMarker(location) {
        if (!this.map) {
            console.log('Map not available for user marker update');
            return;
        }
        
        console.log('Updating user marker with location:', location);
        
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
            console.log('User marker updated successfully');
        } catch (error) {
            console.error('更新用户位置标记失败:', error);
        }
    }

    // 新增：查找100m范围内的点
    findNearbyMarkers(userLocation, range = 100) {
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
        console.log('Starting proximity check for location:', userLocation);
        const storedData = this.getDataFromLocalStorage(this.userId);
        if (!storedData || !storedData.locations) {
            console.log('No stored data available for proximity check');
            return;
        }
        console.log('Found', storedData.locations.length, 'locations in stored data');
        
        const nearby = this.findNearbyMarkers(userLocation, 100);
        console.log('Found', nearby.length, 'nearby markers within 100m');
        
        const playableRecords = [];
        
        // 检查所有附近的marker
        for (const { marker, distance, idx } of nearby) {
            const key = `${marker.latitude}_${marker.longitude}`;
            const audioData = storedData.records[key];
            if (!audioData || !audioData.records.length) {
                console.log('No audio data for marker:', key);
                continue;
            }
            console.log('Checking', audioData.records.length, 'records for marker:', key);
            
            // 检查每条record
            for (const record of audioData.records) {
                if (!record.isPlay) {
                    console.log('Record', record.record_id, 'is not playable');
                    continue;
                }
                const outerRadius = record.outer_radius;
                const innerRadius = record.inner_radius;
                console.log('checking play state', record.record_id, distance, outerRadius, innerRadius);
                if (distance <= outerRadius && distance >= innerRadius) {
                    playableRecords.push({ record, distance, idx });
                    console.log(`音频点${idx + 1}在播放范围内，距离: ${distance}m，record:`, record.record_id);
                }
            }
        }
        
        // 播放所有符合条件的音频
        for (const { record } of playableRecords) {
            await this.playAudio(record, this.userId);
        }
        
        // 停止不在范围内的音频
        const currentPlayingIds = Array.from(this.playingRecords);
        for (const recordId of currentPlayingIds) {
            const isStillInRange = playableRecords.some(({ record }) => record.record_id === recordId);
            if (!isStillInRange) {
                console.log(`音频 ${recordId} 已离开播放范围，停止播放`);
                this.stopSpecificAudio(recordId);
            }
        }
        
        console.log(`位置检查完成，当前播放 ${this.playingRecords.size} 个音频`);
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
        console.error('Missing required parameters');
        window.app.showToast('参数错误');
        // 如果没有必要参数，返回首页
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 2000);
    }
}); 