export function haptic(type = 'light') {
  if (!navigator.vibrate) return;
  switch (type) {
    case 'light':
      navigator.vibrate(8);
      break;
    case 'medium':
      navigator.vibrate(15);
      break;
    case 'success':
      navigator.vibrate([12, 60, 12]);
      break;
    case 'error':
      navigator.vibrate([30, 50, 30, 50, 30]);
      break;
  }
}
