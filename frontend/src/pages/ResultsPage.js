import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import useTheme from '../hooks/useTheme';
import '../index.css';

const API = '/api';

export default function ResultsPage() {
  const { slug } = useParams();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useTheme(data?.list?.theme || {});

  useEffect(() => {
    axios.get(`${API}/lists/${slug.replace('-resultaten', slug)}/results`)
      // Fallback: probeer op id
      .catch(() => axios.get(`${API}/lists/${slug}/results`))
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [slug]);

  // Haal de lijst op via slug dan results via id
  useEffect(() => {
    (async () => {
      try {
        const listRes = await axios.get(`${API}/lists/${slug}`);
        const resRes  = await axios.get(`${API}/lists/${listRes.data.id}/results`);
        setData(resRes.data);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) return <div className="page-center"><p>Laden…</p></div>;
  if (!data)   return <div className="page-center"><h2>Niet gevonden</h2></div>;

  const { list, results } = data;
  const max = results[0]?.score || 1;

  const bgStyle = list.bg_image
    ? { backgroundImage:`url(${list.bg_image})`, backgroundSize:'cover', backgroundPosition:'center', minHeight:'100vh' }
    : { minHeight:'100vh', background:'var(--color-bg)' };

  return (
    <div style={bgStyle}>
      <div className="page-wrap">
        <h1 style={{ marginBottom:4 }}>{list.name}</h1>
        <p className="helper-text" style={{ marginBottom:24 }}>Tussenstand</p>

        {results.length === 0 ? (
          <p>Er zijn nog geen stemmen uitgebracht.</p>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {results.map((t, i) => (
              <div key={t.id} className="card" style={{ padding:'14px 16px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                  <span style={{
                    fontSize: i < 3 ? 24 : 16,
                    fontWeight: 700,
                    minWidth: 36,
                    color: i === 0 ? '#c8a000' : i === 1 ? '#888' : i === 2 ? '#b06000' : '#666',
                  }}>
                    {i + 1}
                  </span>
                  {t.cover_url && <img src={t.cover_url} alt="" style={{ width:50, height:50, objectFit:'cover', borderRadius:6 }} />}
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700 }}>{t.artist}</div>
                    <div style={{ fontSize:14 }}>{t.title}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontWeight:700, color:'var(--color-primary)' }}>{t.score} pt</div>
                    <div style={{ fontSize:12, color:'#888' }}>{t.vote_count}×</div>
                  </div>
                </div>
                {/* Scorebalk */}
                <div style={{ marginTop:8, height:4, background:'#eee', borderRadius:2 }}>
                  <div style={{
                    width:`${(t.score / max) * 100}%`,
                    height:'100%',
                    background:'var(--color-primary)',
                    borderRadius:2,
                    transition:'width .4s',
                  }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
