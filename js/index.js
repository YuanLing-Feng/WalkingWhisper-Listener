// 首页逻辑
class IndexPage {
    constructor() {
        this.workList = [];
        this.isLoading = true;
        this.currentLocation = null;
        this.userIdCache = {};
        this.userNameCache = {};
        
        this.init();
    }

    init() {
        console.log('Index page onLoad');
        
        // 设置位置更新回调
        window.app.setLocationCallback((location) => {
            console.log('Index page location callback triggered:', location);
            this.currentLocation = location;
            
            // 如果已经有作品列表，更新距离
            if (this.workList.length > 0) {
                this.updateDistances(location);
            } else {
                // 如果还没有作品列表，获取作品列表
                this.fetchWorkList(location);
            }
        });
        
        this.initData();
    }

    initData() {
        console.log('Initializing data...');
        this.isLoading = true;
        this.updateLoadingState();
        
        const currentLocation = window.app.globalData.currentLocation;
        console.log('Current location from app:', currentLocation);
        
        if (currentLocation && window.app.globalData.isLocationInitialized) {
            this.currentLocation = currentLocation;
            this.fetchWorkList(currentLocation);
        } else {
            console.log('No location available yet, waiting for location callback...');
            this.isLoading = false;
            this.updateLoadingState();
            this.updateDebugInfo('等待位置信息...');
        }
    }

    updateDistances(location) {
        if (!location) return;

        const workListWithDistance = this.workList.map(project => {
            const firstLocation = project.locations[0];
            let distance = 'loading...';
            let distanceValue = Infinity;
            
            if (location && firstLocation) {
                distanceValue = window.utils.calculateDistance(
                    location.latitude,
                    location.longitude,
                    firstLocation.lat,
                    firstLocation.lng
                );
                distance = window.utils.formatDistance(distanceValue);
            }
            
            return {
                ...project,
                distance: distance === 'loading...' ? distance : distance,
                distanceValue
            };
        });

        const sortedWorkList = workListWithDistance.sort((a, b) => {
            return a.distanceValue - b.distanceValue;
        });

        this.workList = sortedWorkList;
        this.renderWorkList();
        this.updateDebugInfo(`当前位置: 纬度 ${location.latitude.toFixed(6)}, 经度 ${location.longitude.toFixed(6)}`);
    }

    async fetchWorkList(location) {
        console.log('Fetching worklist for location:', location);
        const url = `https://nyw6vsud2p.ap-northeast-1.awsapprunner.com/api/v1/get/worklist?latitude=${location.latitude}&longitude=${location.longitude}&radius=3`;
        console.log('Request URL:', url);
        
        try {
            const res = await window.utils.request(url);
            console.log('API Response:', res);
            
            if (res.code === 200 && res.data) {
                // 处理返回的数据
                const workList = res.data.map((work, index) => {
                    // 计算距离
                    const distance = window.utils.calculateDistance(
                        location.latitude,
                        location.longitude,
                        work.firstpoint_location.lat,
                        work.firstpoint_location.lng
                    );
                    
                    const workId = index + 1;
                    
                    // 缓存user_id和user_name
                    this.userIdCache[workId] = work.user_id;
                    this.userNameCache[workId] = work.user_name || work.username || work.user_id;
                    
                    console.log(`Cached user_id for work ${workId}:`, work.user_id);
                    console.log(`Cached user_name for work ${workId}:`, this.userNameCache[workId]);
                    
                    return {
                        id: workId,
                        title: work.work_name,
                        points: work.playable_marker_count.toString(),
                        distance: window.utils.formatDistance(distance),
                        distanceValue: distance,
                        author: work.user_name || work.username || work.user_id,
                        creationTime: new Date().toISOString().split('T')[0],
                        description: `音频作品：${work.work_name}`,
                        locations: [work.firstpoint_location]
                    };
                });

                // 按距离排序
                const sortedWorkList = workList.sort((a, b) => a.distanceValue - b.distanceValue);

                this.workList = sortedWorkList;
                this.isLoading = false;
                this.updateLoadingState();
                this.renderWorkList();
                this.updateDebugInfo(`当前位置: 纬度 ${location.latitude.toFixed(6)}, 经度 ${location.longitude.toFixed(6)}`);
            } else {
                this.workList = [];
                this.isLoading = false;
                this.updateLoadingState();
                this.updateDebugInfo('暂无作品数据');
            }
        } catch (err) {
            console.error('API Request Failed:', err);
            this.workList = [];
            this.isLoading = false;
            this.updateLoadingState();
            this.updateDebugInfo('获取数据失败');
            window.app.showToast('获取数据失败');
        }
    }

    renderWorkList() {
        const workListContainer = document.getElementById('work-list');
        
        if (this.workList.length === 0) {
            workListContainer.innerHTML = '<div class="loading">暂无作品</div>';
            return;
        }

        const workListHTML = this.workList.map(item => `
            <div class="item" data-id="${item.id}" data-user-id="${this.userIdCache[item.id]}" data-user-name="${this.userNameCache[item.id]}">
                <div class="item-left">
                    <div class="title">${item.title}</div>
                    <div class="info">${item.points} points</div>
                </div>
                <div class="item-right">
                    <div class="distance">${this.isLoading ? 'loading...' : item.distance}</div>
                    <div class="from-text">from you</div>
                </div>
            </div>
        `).join('');

        workListContainer.innerHTML = workListHTML;
        
        // 添加点击事件
        const items = workListContainer.querySelectorAll('.item');
        items.forEach(item => {
            item.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                const userId = e.currentTarget.dataset.userId;
                const userName = e.currentTarget.dataset.userName;
                this.goToDetail(id, userId, userName);
            });
        });
    }

    updateLoadingState() {
        const workListContainer = document.getElementById('work-list');
        if (this.isLoading) {
            workListContainer.innerHTML = '<div class="loading">正在加载作品列表...</div>';
        }
    }

    updateDebugInfo(message) {
        const debugInfo = document.getElementById('debug-info');
        if (debugInfo) {
            debugInfo.innerHTML = `<span>${message}</span>`;
        }
    }

    goToDetail(id, userId, userName) {
        console.log('Going to detail page:', id, userId, userName);
        
        // 使用URL参数跳转到详情页
        const detailUrl = `detail.html?id=${id}&userId=${encodeURIComponent(userId)}&userName=${encodeURIComponent(userName)}`;
        window.location.href = detailUrl;
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.indexPage = new IndexPage();
}); 