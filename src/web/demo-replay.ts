export function replaySteps(total: number, reducedMotion: boolean, show: (count: number) => void): () => void {
  if (reducedMotion || total === 0) {
    show(total);
    return () => {};
  }
  let visible = 0;
  show(visible);
  const timer = setInterval(() => {
    show(++visible);
    if (visible >= total) clearInterval(timer);
  }, 400);
  return () => clearInterval(timer);
}
