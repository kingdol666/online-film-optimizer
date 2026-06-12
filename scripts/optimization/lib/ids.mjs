export function uniqueNowId() {
  const d = new Date();
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  const millis = pad(d.getMilliseconds(), 3);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${millis}-${random}`;
}
