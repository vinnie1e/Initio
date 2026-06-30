importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  // The SDK will try to auto-configure if possible, or it relies on default initialization.
  // In a real app we'd inject the config, but for AI Studio preview this simple shim is enough.
  projectId: "ai-studio-preview",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:123456789"
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/firebase-logo.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
