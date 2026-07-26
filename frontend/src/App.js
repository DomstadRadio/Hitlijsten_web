import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AdminPage    from './pages/AdminPage';
import VotePage     from './pages/VotePage';
import VerifyPage   from './pages/VerifyPage';
import SubmitPage   from './pages/SubmitPage';
import ThankYouPage from './pages/ThankYouPage';
import ResultsPage  from './pages/ResultsPage';
import ChartPage    from './pages/ChartPage';
import FormPage     from './pages/FormPage';
import { AuthProvider } from './context/AuthContext';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
          <h2>Er is een fout opgetreden</h2>
          <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 13 }}>
            {this.state.error.toString()}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
    <BrowserRouter>
      <Routes>
        {/* Admin */}
        <Route path="/admin/*" element={<AdminPage />} />

        {/* Publiek stemformulier */}
        <Route path="/stem/:slug"                  element={<VotePage />} />
        <Route path="/stem/:slug/verify/:token"    element={<VerifyPage />} />
        <Route path="/stem/:slug/stemmen/:token"   element={<SubmitPage />} />
        <Route path="/stem/:slug/bedankt"          element={<ThankYouPage />} />
        <Route path="/stem/:slug/resultaten"       element={<ResultsPage />} />

        {/* Publieke hitlijst */}
        <Route path="/stem/:slug/hitlijst"         element={<ChartPage />} />

        {/* Custom formulieren */}
        <Route path="/formulier/:slug"             element={<FormPage />} />

        {/* Fallback */}
        <Route path="*" element={
          <div style={{ textAlign: 'center', marginTop: 80 }}>
            <h2>Pagina niet gevonden</h2>
          </div>
        } />
      </Routes>
    </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  );
}
