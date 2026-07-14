import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6"
      style={{ background: 'radial-gradient(ellipse at center, #1A3A1C 0%, #0C150D 70%)' }}>

      <div className="w-full max-w-sm animate-fade-up">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-24 h-24 rounded-[28px] bg-white flex items-center justify-center animate-logo-pulse mb-5 shadow-lg overflow-hidden">
            <img src="/icon-512.png" alt="La Brasserie des Plantes" className="w-full h-full object-contain" />
          </div>
          <h1 className="font-serif text-[26px] font-semibold text-text text-center">
            La Brasserie des Plantes
          </h1>
          <p className="text-[12px] text-text-muted tracking-[2px] uppercase mt-2">
            Notes de frais
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-500/30 rounded-2xl px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-2xl px-5 py-4 text-text placeholder:text-text-dim focus:outline-none focus:border-green-mid transition-colors"
            />
          </div>

          <div>
            <input
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-2xl px-5 py-4 text-text placeholder:text-text-dim focus:outline-none focus:border-green-mid transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-[18px] rounded-[18px] text-white font-semibold text-base transition-transform active:scale-[0.97] disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #2D6A27, #4A9E40)',
              boxShadow: '0 4px 20px rgba(77, 158, 64, 0.3)',
            }}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Connexion...
              </span>
            ) : (
              'Se connecter'
            )}
          </button>
        </form>

        <p className="text-center text-text-dim text-xs mt-8">
          Artisanalement vôtre — LBDP
        </p>
      </div>
    </div>
  );
}
