import { render } from 'preact';
// Self-hosted fonts (no request to Google), Latin subsets only.
import '@fontsource/figtree/latin-500.css';
import '@fontsource/figtree/latin-600.css';
import '@fontsource/figtree/latin-700.css';
import '@fontsource/figtree/latin-ext-600.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/source-sans-3/latin-ext-400.css';
import './styles.css';
import { App } from './App';

render(<App />, document.getElementById('app')!);
