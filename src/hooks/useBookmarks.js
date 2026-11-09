import { useContext } from 'react';
import { BookmarksContext } from '../context/BookmarksContextInstance';

/**
 * Custom hook to consume the BookmarksContext.
 * @returns {{
 *   bookmarks: Array<Object>,
 *   bookmarksCount: number,
 *   isBookmarked: (id: string|number) => boolean,
 *   addBookmark: (item: Object) => void,
 *   removeBookmark: (id: string|number) => void,
 *   toggleBookmark: (item: Object) => void,
 *   clearBookmarks: () => void
 * }}
 */
export function useBookmarks() {
  const context = useContext(BookmarksContext);

  if (!context) {
    throw new Error('useBookmarks must be used within a BookmarksProvider');
  }

  return context;
}
