// The demo's background script (an event page in Firefox MV3). The toolbar
// button opens the sidebar, where the demo runs.
browser.action.onClicked.addListener(() => {
  browser.sidebarAction.open();
});
