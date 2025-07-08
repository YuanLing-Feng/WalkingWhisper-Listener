class App {
    constructor() {
        this.globalData = {
            currentLocation: null,
            locationCallback: null,
            isLocationInitialized: false
        };
        
        this.watchId = null;
        this.hasRequestedPermission = false; // 是否已经请求过权限
        
        this.init();
    }

    init() {
        console.log('App launching...');
        
        // 检查是否已经请求过位置权限
        const permissionStatus = localStorage.getItem('locationPermissionRequested');
        this.hasRequestedPermission = permissionStatus === 'true';
        
        this.initLocationService();
    }

    setLocationCallback(callback) {
        this.globalData.locationCallback = callback;
        
        if (this.globalData.currentLocation && this.globalData.isLocationInitialized) {
            callback(this.globalData.currentLocation);
        }
    }

    initLocationService() {
        console.log('Initializing location service...');
        
        if (navigator.geolocation && navigator.permissions) {
            navigator.permissions.query({ name: 'geolocation' }).then((result) => {
                if (result.state === 'granted') {
                    console.log('Location permission granted, starting watch directly');
                    localStorage.setItem('locationPermissionRequested', 'true');
                    this.startLocationWatch();
                } else if (result.state === 'prompt') {
                    console.log('Location permission prompt, requesting permission');
                    this.requestLocationPermission();
                } else if (result.state === 'denied') {
                    console.error('Location permission denied');
                    localStorage.setItem('locationPermissionRequested', 'false');
                    this.showToast('位置权限被拒绝，请在浏览器设置中允许位置访问');
                }
            }).catch((error) => {
                console.error('Permission query failed:', error);
                this.showToast('无法检查位置权限，请刷新页面重试');
            });
        } else {
            console.error('Geolocation or permissions API is not supported');
            this.showToast('您的浏览器不支持位置服务');
        }
    }

    requestLocationPermission() {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('Location permission granted, starting watch');
                localStorage.setItem('locationPermissionRequested', 'true');
                this.hasRequestedPermission = true;
                this.startLocationWatch();
            },
            (error) => {
                console.error('Location permission denied:', error);
                this.handleLocationError(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }

    startLocationWatch() {
        console.log('Starting location watch...');
        
        if (!this.globalData.isLocationInitialized && navigator.geolocation) {
            if (this.watchId) {
                navigator.geolocation.clearWatch(this.watchId);
            }
            
            this.watchId = navigator.geolocation.watchPosition(
                (position) => {
                    console.log('Location updated:', position);
                    const location = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy
                    };
                    
                    this.globalData.currentLocation = location;
                    this.globalData.isLocationInitialized = true;
                    
                    if (this.globalData.locationCallback) {
                        this.globalData.locationCallback(location);
                    }
                },
                (error) => {
                    console.error('Location watch failed:', error);
                    this.handleLocationError(error);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 30000
                }
            );
        }
    }

    handleLocationError(error) {
        switch(error.code) {
            case error.PERMISSION_DENIED:
                this.showToast('位置权限被拒绝，请在浏览器设置中允许位置访问');
                localStorage.setItem('locationPermissionRequested', 'false');
                this.hasRequestedPermission = false;
                break;
            case error.POSITION_UNAVAILABLE:
                this.showToast('位置信息不可用');
                break;
            case error.TIMEOUT:
                this.showToast('获取位置超时');
                break;
            default:
                this.showToast('获取位置失败');
                break;
        }
    }

    stopLocationUpdate() {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }

    showToast(message, duration = 2000) {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            z-index: 10000;
            pointer-events: none;
        `;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, duration);
    }

    onHide() {
        this.stopLocationUpdate();
    }
}

window.app = new App();

window.addEventListener('beforeunload', () => {
    if (window.app) {
        window.app.onHide();
    }
});