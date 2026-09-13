/** Repeated selection/self-links keep the existing adjacency request and result. */
export function selectAtlasCell(currentIndex, nextIndex, focus, { focusHeading, changeSelection }) {
  if (currentIndex === nextIndex) { if (focus) focusHeading(); return; }
  changeSelection(nextIndex, focus);
}
