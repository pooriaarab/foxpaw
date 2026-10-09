// Puts the tab foxpaw drives into a tab group whose title shows the run:
// "foxpaw · step N", then "foxpaw · done" or "foxpaw · blocked". A tab the
// user already put in their own group stays there and is not renamed.
// tabs.group: Firefox 138. tabGroups.get/update: Firefox 139.

/** The part of the `browser` object the tab group uses. */
export interface TabGroupApi {
  tabs: { get(tabId: number): Promise<{ groupId?: number; windowId?: number }>; group(options: { tabIds: number | number[]; createProperties?: { windowId?: number } }): Promise<number> };
  tabGroups: { get(groupId: number): Promise<{ title?: string }>; update(groupId: number, update: { title?: string; color?: string }): Promise<unknown> };
}

export interface TabGroupStatus {
  /** Sets the title. Errors are ignored: the group is only a status display. */
  title(text: string, color?: string): Promise<void>;
}

/** Groups the tab, or returns null when tab groups are missing or the tab is in the user's own group. */
export async function groupTab(tabId: number, browser = (globalThis as { browser?: Partial<TabGroupApi> }).browser): Promise<TabGroupStatus | null> {
  if (!browser?.tabs?.group || !browser.tabGroups?.update) return null;
  const api = browser as TabGroupApi;
  try {
    const tab = await api.tabs.get(tabId);
    let groupId = tab.groupId ?? -1;
    if (groupId >= 0) {
      const group = await api.tabGroups.get(groupId);
      if (!group.title?.startsWith("foxpaw")) return null;
    } else {
      groupId = await api.tabs.group({ tabIds: tabId, createProperties: { windowId: tab.windowId } });
    }
    return {
      async title(text, color = "orange") {
        await api.tabGroups.update(groupId, { title: text, color }).catch(() => {});
      },
    };
  } catch {
    return null;
  }
}
