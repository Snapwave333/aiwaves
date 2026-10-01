// The AIWaves opening: plays once per launch; any click or key skips. When it ends it fades out and
// tells the app shell (an in-page navigation to #done), which then shows the workspace.
(() => {
  const v = document.getElementById('intro');
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    document.body.classList.add('out');
    setTimeout(() => { location.hash = 'done'; }, 460);
  };
  v.addEventListener('playing', () => document.body.classList.add('ready'), { once: true });
  v.addEventListener('ended', done);
  v.addEventListener('error', done);                 // a missing or broken file never blocks the app
  addEventListener('keydown', done);
  addEventListener('mousedown', done);
  v.play().catch(() => { v.muted = true; v.play().catch(done); });   // if sound is refused, play muted
  setTimeout(done, 15000);                             // never longer than 15 s, whatever happens
})();
