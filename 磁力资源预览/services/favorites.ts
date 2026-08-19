// 收藏本地持久化

import { FAVORITES_KEY } from "../constants";
import type { FavoriteItem } from "../types";

export function loadFavorites(): FavoriteItem[] {
  return Storage.get<FavoriteItem[]>(FAVORITES_KEY) ?? [];
}

export function persistFavorites(items: FavoriteItem[]) {
  Storage.set(FAVORITES_KEY, items);
}
