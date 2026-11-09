import { useState, useEffect, useCallback, useMemo } from 'react';
import { getStorageItem, setStorageItem } from '../utils/storage';
import { BookmarksContext } from './BookmarksContextInstance';

const STORAGE_KEY = 'bookmarks';

/**
 * Standard shape of a media item in Cinemate bookmarks:
 * {
 *   id: string | number,
 *   title: string,
 *   type: 'movie' | 'tv' | 'anime' | 'match',
 *   posterUrl?: string,
 *   backdropUrl?: string,
 *   year?: string | number,
 *   rating?: number,
 *   overview?: string,
 *   addedAt: number
 * }
 */

export function BookmarksProvider({ children }) {
  const [bookmarks, setBookmarks] = useState(() => {
    return getStorageItem(STORAGE_KEY, []);
  });

  // Keep localStorage synchronized whenever bookmarks change
  useEffect(() => {
    setStorageItem(STORAGE_KEY, bookmarks);
  }, [bookmarks]);

  // Sync across different browser tabs/windows
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === `cinemate_${STORAGE_KEY}`) {
        try {
          const updated = e.newValue ? JSON.parse(e.newValue) : [];
          setBookmarks(updated);
        } catch (err) {
          console.warn('[BookmarksProvider] Error synchronizing storage event:', err);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const isBookmarked = useCallback((itemId) => {
    if (!itemId) return false;
    return bookmarks.some((item) => String(item.id) === String(itemId));
  }, [bookmarks]);

  const addBookmark = useCallback((item) => {
    if (!item || !item.id) return;
    setBookmarks((prev) => {
      const exists = prev.some((b) => String(b.id) === String(item.id));
      if (exists) return prev;

      const normalizedItem = {
        id: item.id,
        title: item.title || item.name || 'Sin título',
        type: item.type || 'movie',
        posterUrl: item.posterUrl || item.poster_path || '',
        backdropUrl: item.backdropUrl || item.backdrop_path || '',
        year: item.year || item.release_date?.slice(0, 4) || '',
        rating: item.rating ?? item.vote_average ?? 0,
        overview: item.overview || '',
        addedAt: Date.now(),
      };

      return [normalizedItem, ...prev];
    });
  }, []);

  const removeBookmark = useCallback((itemId) => {
    if (!itemId) return;
    setBookmarks((prev) => prev.filter((item) => String(item.id) !== String(itemId)));
  }, []);

  const toggleBookmark = useCallback((item) => {
    if (!item || !item.id) return;
    if (isBookmarked(item.id)) {
      removeBookmark(item.id);
    } else {
      addBookmark(item);
    }
  }, [isBookmarked, removeBookmark, addBookmark]);

  const clearBookmarks = useCallback(() => {
    setBookmarks([]);
  }, []);

  const value = useMemo(() => ({
    bookmarks,
    bookmarksCount: bookmarks.length,
    isBookmarked,
    addBookmark,
    removeBookmark,
    toggleBookmark,
    clearBookmarks,
  }), [bookmarks, isBookmarked, addBookmark, removeBookmark, toggleBookmark, clearBookmarks]);

  return (
    <BookmarksContext.Provider value={value}>
      {children}
    </BookmarksContext.Provider>
  );
}
