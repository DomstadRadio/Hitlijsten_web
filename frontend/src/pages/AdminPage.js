import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import '../index.css';
import './AdminPage.css';
import ListEditor from '../components/ListEditor';
import TrackManager from '../components/TrackManager';
import SubmissionsManager from '../components/SubmissionsManager';
import VotersView from '../components/VotersView';
import NoVotersView from '../components/NoVotersView';
import BlockedVotersView from '../components/BlockedVotersView';
import ChartView from '../components/ChartView';
import UserManager from '../components/UserManager';
import SettingsPanel from '../components/SettingsPanel';
import AuditLogView from '../components/AuditLogView';
import ProgramsManager from '../components/ProgramsManager';
import FormsManager from '../components/FormsManager';
import FormBuilder from '../components/FormBuilder';
import FormResponses from '../components/FormResponses';
import LoginForm from '../components/LoginForm';
import BroadcastPanel from '../components/BroadcastPanel';
import { useAuth } from '../context/AuthContext';

const API = '/api';

export default function AdminPage() {
  const { hasPerm, logout, user, loading: authLoading } = useAuth();

  const [lists, setLists]           = useState([]);
  const [selected, setSelected]     = useState(null);
  const [selectedForm, setSelectedForm] = useState(null);
  const [view, setView]             = useState('lists');
  const [loading, setLoading]       = useState(true);

  const loadLists = useCallback(async () => {
    setLoading(true);
    const res = await axios.get(`${API}/lists`);
    setLists(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { if (user) loadLists(); }, [user, loadLists]);

  const openEdit        = (list) => { setSelected(list); setView('edit'); };
  const openTracks      = (list) => { setSelected(list); setView('tracks'); };
  const openSubmissions = (list) => { setSelected(list); setView('submissions'); };
  const openVoters      = (list) => { setSelected(list); setView('voters'); };
  const openBroadcast   = (list) => { setSelected(list); setView('broadcast'); };
  const openNoVoters    = (list) => { setSelected(list); setView('no-voters'); };
  const openBlocked     = (list) => { setSelected(list); setView('blocked'); };
  const openChart       = (list) => { setSelected(list); setView('chart'); };
  const backToLists     = () => { setSelected(null); setView('lists'); loadLists(); };

  const deleteList = async (id) => {
    if (!window.confirm('Lijst verwijderen?')) return;
    await axios.delete(`${API}/lists/${id}`);
    loadLists();
  };

  const statusLabel = { draft: 'Concept', open: 'Open', closed: 'Gesloten' };
  const statusColor = { draft: '#888', open: '#080', closed: '#c00' };

  // Auth guard
  if (authLoading) return <div style={{ padding: 40 }}>Laden…</div>;
  if (!user) return <LoginForm />;

  return (
    <div className="admin-wrap">
      <header className="admin-header">
        <h1>🎵 Hitlijsten Beheer</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasPerm('forms') && view !== 'forms' && view !== 'form-edit' && view !== 'form-responses' && (
            <button className="btn btn-outline btn-sm" onClick={() => { setSelected(null); setSelectedForm(null); setView('forms'); }}>
              📋 Formulieren
            </button>
          )}
          {hasPerm('forms') && view !== 'programs' && (
            <button className="btn btn-outline btn-sm" onClick={() => { setSelected(null); setView('programs'); }}>
              📻 Programma's
            </button>
          )}
          {hasPerm('users') && view !== 'users' && (
            <button className="btn btn-outline btn-sm" onClick={() => { setSelected(null); setView('users'); }}>
              👤 Gebruikers
            </button>
          )}
          {hasPerm('audit') && view !== 'audit' && (
            <button className="btn btn-outline btn-sm" onClick={() => { setSelected(null); setView('audit'); }}>
              🗂 Log
            </button>
          )}
          {hasPerm('settings') && view !== 'settings' && (
            <button className="btn btn-outline btn-sm" onClick={() => { setSelected(null); setView('settings'); }}>
              ⚙️ Instellingen
            </button>
          )}
          {view !== 'lists' && (
            <button className="btn btn-outline btn-sm" onClick={backToLists}>
              ← Terug naar overzicht
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={logout} style={{ marginLeft: 8 }}>
            Uitloggen
          </button>
        </div>
      </header>

      {view === 'lists' && (
        <div>
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:16 }}>
            {hasPerm('lists') && (
              <button className="btn" onClick={() => { setSelected(null); setView('edit'); }}>
                + Nieuwe lijst
              </button>
            )}
          </div>

          {loading ? <p>Laden…</p> : lists.length === 0 ? (
            <p className="helper-text">Nog geen lijsten aangemaakt.</p>
          ) : (
            <div className="list-grid">
              {lists.map(l => (
                <div key={l.id} className="list-card card">
                  {l.bg_image && (
                    <div className="list-card-bg" style={{ backgroundImage: `url(${l.bg_image})` }} />
                  )}
                  <div className="list-card-body">
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                      <div>
                        <h3>{l.name}</h3>
                        <span style={{ fontSize:12, color:statusColor[l.status] }}>
                          ● {statusLabel[l.status]}
                        </span>
                        {l.domain && <span className="helper-text"> · {l.domain}</span>}
                      </div>
                      <span className="votes-badge">{l.max_votes} keuzes</span>
                    </div>
                    {l.description && <p className="helper-text" style={{ marginTop:8 }}>{l.description}</p>}
                    <div className="list-card-actions">
                      {hasPerm('lists') && (
                        <button className="btn btn-sm" onClick={() => openEdit(l)}>✏️ Bewerken</button>
                      )}
                      {hasPerm('tracks') && (
                        <button className="btn btn-sm btn-outline" onClick={() => openTracks(l)}>🎵 Tracks</button>
                      )}
                      {hasPerm('submissions') && (
                        <button className="btn btn-sm btn-outline" onClick={() => openSubmissions(l)}>📋 Inzendingen</button>
                      )}
                      {hasPerm('voters') && (
                        <button className="btn btn-sm btn-outline" onClick={() => openVoters(l)}>📞 Stemmers</button>
                      )}
                      {hasPerm('submissions') && (
                        <button className="btn btn-sm btn-outline" onClick={() => openBroadcast(l)}>📢 Broadcast</button>
                      )}
                      {hasPerm('submissions') && (
                        <button className="btn btn-sm btn-outline" onClick={() => openNoVoters(l)}>⚠️ Niet gestemd</button>
                      )}
                      {hasPerm('blocks') && (
                        <button className="btn btn-sm btn-outline" onClick={() => openBlocked(l)}>⛔ Blokkeringen</button>
                      )}
                      {hasPerm('chart') && (
                        <button className="btn btn-sm btn-outline" onClick={() => openChart(l)}>📊 Hitlijst</button>
                      )}
                      <a className="btn btn-sm btn-outline" href={`/stem/${l.slug}`} target="_blank" rel="noreferrer">
                        🔗 Stemformulier
                      </a>
                      {hasPerm('lists') && (
                        <button className="btn btn-sm" style={{ background:'#c00' }} onClick={() => deleteList(l.id)}>
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'edit' && hasPerm('lists') && (
        <ListEditor list={selected} onSaved={backToLists} />
      )}

      {view === 'tracks' && selected && hasPerm('tracks') && (
        <TrackManager list={selected} />
      )}

      {view === 'submissions' && selected && hasPerm('submissions') && (
        <SubmissionsManager list={selected} onNoVoters={() => openNoVoters(selected)} />
      )}

      {view === 'voters' && selected && hasPerm('voters') && (
        <VotersView list={selected} />
      )}

      {view === 'broadcast' && selected && hasPerm('submissions') && (
        <BroadcastPanel list={selected} />
      )}

      {view === 'no-voters' && selected && hasPerm('submissions') && (
        <NoVotersView list={selected} />
      )}

      {view === 'blocked' && selected && hasPerm('blocks') && (
        <BlockedVotersView list={selected} />
      )}

      {view === 'chart' && selected && hasPerm('chart') && (
        <ChartView list={selected} />
      )}

      {view === 'users' && hasPerm('users') && (
        <UserManager />
      )}

      {view === 'audit' && hasPerm('audit') && (
        <AuditLogView />
      )}

      {view === 'programs' && hasPerm('forms') && (
        <ProgramsManager />
      )}

      {view === 'settings' && hasPerm('settings') && (
        <SettingsPanel />
      )}

      {view === 'forms' && hasPerm('forms') && (
        <FormsManager
          onEdit={(f) => { setSelectedForm(f); setView('form-edit'); }}
          onResponses={(f) => { setSelectedForm(f); setView('form-responses'); }}
        />
      )}

      {view === 'form-edit' && selectedForm && hasPerm('forms') && (
        <FormBuilder
          form={selectedForm}
          onSaved={() => setView('forms')}
          onBack={() => setView('forms')}
        />
      )}

      {view === 'form-responses' && selectedForm && hasPerm('forms') && (
        <FormResponses
          form={selectedForm}
          onBack={() => setView('forms')}
        />
      )}
    </div>
  );
}
