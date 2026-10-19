import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import useTheme from '../hooks/useTheme';
import '../index.css';

const API = '/api';

/**
 * TokenVerifyPage
 * Verifieert automatisch via de token uit de email-link.
 * Als geldig: navigeert naar de stempagina
 * Als verlopen: toont foutmelding + link naar aanmelden
 */
export default function TokenVerifyPage() {
  const { slug, token } = useParams();
  const navigate = useNavigate();

  const [list, setList] = useState(null);
  const [status, setStatus] = useState('verifying'); // 'verifying' | 'success' | 'expired' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  useTheme(list?.theme || {});

  useEffect(() => {
    (async () => {
      try {
        // Fetch lijst info
        const listRes = await axios.get(`${API}/lists/${slug}`);
        setList(listRes.data);

        // Verifieert automatisch via token
        const verifyRes = await axios.get(`${API}/vote/${slug}/verify/${token}`);

        // Succes! Navigeer naar stempagina
        navigate(`/stem/${slug}/stemmen/${verifyRes.data.token}`);
      } catch (err) {
        const errorData = err.response?.data;
        if (err.response?.status === 403) {
          setStatus('expired');
          setErrorMsg(errorData?.error || 'Verificatiecode is verlopen.');
        } else if (err.response?.status === 404) {
          setStatus('error');
          setErrorMsg(errorData?.error || 'Verificatielink niet gevonden.');
        } else {
          setStatus('error');
          setErrorMsg(errorData?.error || 'Er is een fout opgetreden bij verificatie.');
        }
      }
    })();
  }, [slug, token, navigate]);

  return (
    <div className="page-wrap">
      <div style={{ maxWidth: 560, margin: '60px auto', textAlign: 'center', fontFamily: 'sans-serif' }}>
        {status === 'verifying' && (
          <>
            <h2>Bezig met verificatie...</h2>
            <p>Je verificatiecode wordt gecontroleerd. Momentje geduld.</p>
            <div style={{ margin: '40px 0' }}>
              <div style={{
                width: 50,
                height: 50,
                border: '4px solid #e00',
                borderTop: '4px solid transparent',
                borderRadius: '50%',
                margin: '0 auto',
                animation: 'spin 1s linear infinite',
              }} />
              <style>{`
                @keyframes spin {
                  from { transform: rotate(0deg); }
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          </>
        )}

        {status === 'expired' && (
          <>
            <h2 style={{ color: '#d32f2f' }}>⏰ Verificatiecode verlopen</h2>
            <p>{errorMsg}</p>
            <p style={{ marginTop: 30, fontSize: 14, color: '#666 ' }}>
              Je kunt een nieuwe code aanvragen door je e-mailadres in te vullen.
            </p>
            <button
              onClick={() => navigate(`/stem/${slug}`)}
              style={{
                marginTop: 20,
                padding: '12px 32px',
                background: '#e00',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              Terug naar stemmen
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 style={{ color: '#d32f2f' }}>❌ Fout</h2>
            <p>{errorMsg}</p>
            <button
              onClick={() => navigate(`/stem/${slug}`)}
              style={{
                marginTop: 20,
                padding: '12px 32px',
                background: '#e00',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              Terug naar stemmen
            </button>
          </>
        )}
      </div>
    </div>
  );
}
