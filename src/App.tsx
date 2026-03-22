import { AppShell } from './components/layout/AppShell';
import { useTheme } from './hooks/useTheme';
import './App.css';

function App() {
  // Initialize theme system on mount
  useTheme();

  return <AppShell />;
}

export default App;
