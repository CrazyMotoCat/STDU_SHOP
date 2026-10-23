Object.defineProperty(process.stdin, 'isTTY', {
  configurable: true,
  value: true,
});
Object.defineProperty(process.stdout, 'isTTY', {
  configurable: true,
  value: true,
});
process.stdin.setRawMode ??= () => process.stdin;
