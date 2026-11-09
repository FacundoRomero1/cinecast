import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { BookmarksProvider } from './context/BookmarksContext';
import { Navbar } from './components/layout/Navbar';
import { HomePage } from './pages/HomePage';
import { BookmarksPage } from './pages/BookmarksPage';
import { MochilaPage } from './pages/MochilaPage';
import { ContactoPage } from './pages/ContactoPage';
import { AdminPage } from './pages/AdminPage';

export default function App() {
  return (
    <BookmarksProvider>
      <BrowserRouter>
        <div className="app-container">
          <Navbar />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/marcadores" element={<BookmarksPage />} />
              <Route path="/mochila" element={<MochilaPage />} />
              <Route path="/contacto" element={<ContactoPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </BookmarksProvider>
  );
}
