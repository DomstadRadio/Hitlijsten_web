import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import useTheme from '../hooks/useTheme';
import '../index.css';

const API = '/api';

// Drag-sortable rij (gebruikt external_id als key)
function SortableTrackRow({ track, position, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: track.external_id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="track-card">
      <span className="vote-badge">{position}</span>
      <span className="drag-handle" {...attributes} {...listeners}>⣿</span>
      {track.cover_url
        ? <img src={track.cover_url} alt="" />
        : <div style={{ width:56, height:56, background:'#ddd', borderRadius:8, flexShrink:0 }} />
      }
      <div className="track-info">
        <div className="track-title">{track.title}</div>
        <div className="track-artist">{track.artist}</div>
        {track.source === 'spotify' && (
          <div style={{ fontSize:11, color:'#1DB954', marginTop:2 }}>via Spotify</div>
        )}
      </div>
      <button className="btn btn-sm btn-outline" onClick={() => onRemove(track.external_id)}>✕</button>
    </div>
  );
}

export default function SubmitPage() {
  const { slug, token } = useParams();
  const navigate = useNavigate();

  const [list,       setList]       = useState(null);
  const [results,    setResults]    = useState([]);   // zoekresultaten
  const [selected,   setSelected]   = useState([]);   // geselecteerde tracks
  const [query,      setQuery]      = useState('');
  const [searching,  setSearching]  = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const [comment,    setComment]    = useState('');
  const debounceRef = useRef(null);

  useTheme(list?.theme || {});

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Lijst-info laden
  useEffect(() => {
    axios.get(`${API}/lists/${slug}`)
      .then(res => setList(res.data))
      .catch(() => setList(null))
      .finally(() => setLoading(false));
  }, [slug]);

  // Live search met debounce
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await axios.get(`${API}/search`, { params: { q: query, slug } });
        // Filter al geselecteerde tracks eruit
        const filtered = res.data.filter(
          r => !selected.some(s => s.external_id === r.external_id)
        );
        setResults(filtered);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [query, selected]); // search opnieuw als selected verandert (om duplicaten te filteren)

  const addTrack = (track) => {
    if (selected.length >= (list?.max_votes || 10)) {
      setError(`Je kunt maximaal ${list.max_votes} nummers kiezen`);
      return;
    }
    setError('');
    setSelected(s => [...s, track]);
    setResults(r => r.filter(t => t.external_id !== track.external_id));
  };

  const removeTrack = (external_id) => setSelected(s => s.filter(t => t.external_id !== external_id));

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setSelected(s => {
      const from = s.findIndex(t => t.external_id === active.id);
      const to   = s.findIndex(t => t.external_id === over.id);
      return arrayMove(s, from, to);
    });
  };

  const submit = async () => {
    if (selected.length === 0) return setError('Selecteer minstens één nummer');
    setError('');
    setSubmitting(true);
    try {
      await axios.post(`${API}/vote/${slug}/submit`, {
        token,
        comment: comment.trim() || undefined,
        votes: selected.map((t, i) => ({
          external_id: t.external_id,
          source:      t.source,
          title:       t.title,
          artist:      t.artist,
          album:       t.album  || '',
          cover_url:   t.cover_url  || null,
          year:        t.year   || null,
          position:    i + 1,
        })),
      });
      if (list.redirect_url) {
        window.location.href = list.redirect_url;
      } else {
        navigate(`/stem/${slug}/bedankt`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Indienen mislukt');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="page-center"><p>Laden…</p></div>;
  if (!list)   return <div className="page-center"><h2>Niet gevonden</h2></div>;

  const bgStyle = list.bg_image
    ? { backgroundImage:`url(${list.bg_image})`, backgroundSize:'cover', backgroundPosition:'center', minHeight:'100vh' }
    : { minHeight:'100vh', background:'var(--color-bg)' };

  return (
    <div style={bgStyle}>
      <div className="page-wrap">
        <h1 style={{ marginBottom:4 }}>{list.name}</h1>
        <p className="helper-text" style={{ marginBottom:24 }}>
          Kies jouw favoriete nummers — maximaal <strong>{list.max_votes}</strong>.
          Sleep ze in volgorde van voorkeur.
        </p>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
          {/* Linker kolom: zoeken */}
          <div>
            <h3 style={{ marginBottom:8 }}>Zoek een nummer</h3>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Typ artiest of titel…"
              style={{ marginBottom:12 }}
              autoFocus
            />
            <div style={{ maxHeight:520, overflowY:'auto', display:'flex', flexDirection:'column', gap:8 }}>
              {query.length < 2 && (
                <p className="helper-text">Type minstens 2 tekens om te zoeken.</p>
              )}
              {query.length >= 2 && searching && (
                <p className="helper-text">Zoeken…</p>
              )}
              {query.length >= 2 && !searching && results.length === 0 && (
                <p className="helper-text">Geen nummers gevonden.</p>
              )}
              {results.map(t => (
                <div key={t.external_id} className="track-card" style={{ cursor:'pointer' }}
                  onClick={() => addTrack(t)}>
                  {t.cover_url
                    ? <img src={t.cover_url} alt="" />
                    : <div style={{ width:56, height:56, background:'#ddd', borderRadius:8, flexShrink:0 }} />
                  }
                  <div className="track-info">
                    <div className="track-title">{t.title}</div>
                    <div className="track-artist">{t.artist}</div>
                    {t.source === 'spotify' && (
                      <div style={{ fontSize:11, color:'#1DB954', marginTop:2 }}>via Spotify</div>
                    )}
                  </div>
                  <span style={{ color:'var(--color-primary)', fontSize:22 }}>+</span>
                </div>
              ))}
            </div>
          </div>

          {/* Rechter kolom: jouw keuzes */}
          <div>
            <h3 style={{ marginBottom:8 }}>
              Jouw keuzes ({selected.length}/{list.max_votes})
            </h3>
            {selected.length === 0 ? (
              <p className="helper-text">Klik op een nummer links om het toe te voegen.</p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={selected.map(t => t.external_id)} strategy={verticalListSortingStrategy}>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {selected.map((t, i) => (
                      <SortableTrackRow key={t.external_id} track={t} position={i + 1} onRemove={removeTrack} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {error && <p className="error-text" style={{ marginTop:12 }}>{error}</p>}

            {selected.length > 0 && (
              <div style={{ marginTop:20 }}>
                <label style={{ display:'block', fontWeight:600, marginBottom:6, fontSize:14 }}>
                  Opmerking (optioneel)
                </label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Waarom koos je deze nummers? Of heb je iets te melden?"
                  rows={3}
                  style={{ width:'100%', resize:'vertical', padding:10, borderRadius:8, border:'1px solid #ddd', fontSize:14 }}
                />
              </div>
            )}

            {selected.length > 0 && (
              <button className="btn" style={{ marginTop:12, width:'100%' }}
                onClick={submit} disabled={submitting}>
                {submitting ? 'Indienen…' : `Stem indienen (${selected.length} nummers) →`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
