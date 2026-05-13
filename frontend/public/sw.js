self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'S&P 500 Trends', body: 'New alert!' };
  
  const options = {
    body: data.body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: data.url || '/',
    actions: [
      { action: 'open', title: 'Open Dashboard' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      clients.openWindow(event.notification.data)
    );
  } else {
    event.waitUntil(
      clients.openWindow(event.notification.data)
    );
  }
});
