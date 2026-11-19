import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Box, ChevronDown, ChevronRight, FileBox, Folder, FolderOpen, List, PanelLeftClose, RefreshCw, Search, X } from 'lucide-react';
import { IMPORTERS, type Asset } from '../shared';
import { IconButton } from './Controls';

type BrowserRow = { type: 'folder'; path: string; name: string; depth: number } | { type: 'file'; asset: Asset; depth: number };
export function AssetBrowser({ root, assets, selected, preview, scanning, warnings, onSelect, onFolder, onRefresh, onCollapse }: {
  root: string; assets: Asset[]; selected: string | null; preview?: string; scanning: boolean; warnings: string[];
  onSelect(asset: Asset): void; onFolder(): void; onRefresh(): void; onCollapse(): void;
}) {
  const [query, setQuery] = useState(''), [extension, setExtension] = useState('all'), [tree, setTree] = useState(false), [collapsed, setCollapsed] = useState(new Set<string>());
  const [scroll, setScroll] = useState(0), [height, setHeight] = useState(600);
  const list = useRef<HTMLDivElement>(null), deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const filtered = useMemo(() => assets.filter(asset => (extension === 'all' || asset.extension === extension) && (!deferredQuery || asset.relative.toLowerCase().includes(deferredQuery))), [assets, extension, deferredQuery]);
  const types = useMemo(() => [...new Set(assets.map(asset => asset.extension))].sort(), [assets]);
  const rows = useMemo(() => {
    if (!tree) return filtered.map(asset => ({ type: 'file', asset, depth: 0 } as BrowserRow));
    const rows: BrowserRow[] = [], folders = new Set<string>();
    for (const asset of filtered) {
      const parts = asset.relative.split('/'); let hidden = false;
      for (let i = 0; i < parts.length - 1; i++) {
        const path = parts.slice(0, i + 1).join('/');
        if (!folders.has(path)) { folders.add(path); rows.push({ type: 'folder', path, name: parts[i], depth: i }); }
        if (collapsed.has(path) && !deferredQuery) { hidden = true; break; }
      }
      if (!hidden) rows.push({ type: 'file', asset, depth: parts.length - 1 });
    }
    return rows;
  }, [filtered, tree, collapsed, deferredQuery]);
  const rowHeight = tree ? 40 : 58;
  useEffect(() => { const node = list.current; if (!node) return; const observer = new ResizeObserver(() => setHeight(node.clientHeight)); observer.observe(node); return () => observer.disconnect(); }, []);
  useEffect(() => { list.current?.scrollTo({ top: 0 }); setScroll(0); }, [query, extension, tree, root]);
  const start = Math.max(0, Math.floor(scroll / rowHeight) - 5), end = Math.min(rows.length, Math.ceil((scroll + height) / rowHeight) + 5);
  const selectRelative = (direction: number) => {
    const previewable = filtered.filter(asset => IMPORTERS[asset.extension]);
    const current = previewable.findIndex(asset => asset.path === selected);
    const next = previewable[Math.max(0, Math.min(previewable.length - 1, current + direction))];
    if (!next) return;
    onSelect(next);
    const index = rows.findIndex(row => row.type === 'file' && row.asset.path === next.path);
    if (index >= 0 && list.current) { const top = index * rowHeight; if (top < list.current.scrollTop || top + rowHeight > list.current.scrollTop + height) list.current.scrollTo({ top: Math.max(0, top - height / 2) }); }
  };
  return <aside className="asset-browser">
    <div className="panel-heading"><span>Asset Browser</span><IconButton icon={PanelLeftClose} label="Collapse Asset Browser" onClick={onCollapse} /></div>
    <div className="browser-location"><FolderOpen size={15} /><span title={root}>{root ? root.split(/[\\/]/).pop() : 'No folder selected'}</span><IconButton icon={RefreshCw} label="Refresh folder" disabled={!root || scanning} onClick={onRefresh} className={scanning ? 'spinning' : ''} /></div>
    <div className="browser-search"><Search size={15} /><input aria-label="Search assets" placeholder="Search filename or path" value={query} onChange={event => setQuery(event.target.value)} />{query && <IconButton icon={X} label="Clear search" onClick={() => setQuery('')} />}</div>
    <div className="browser-options"><select aria-label="File type filter" value={extension} onChange={event => setExtension(event.target.value)}><option value="all">All 3D formats</option>{types.map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select><div className="segmented compact"><IconButton icon={List} label="Flat list" active={!tree} onClick={() => setTree(false)} /><IconButton icon={Folder} label="Folder tree" active={tree} onClick={() => setTree(true)} /></div></div>
    <div className="browser-count"><span>{filtered.length.toLocaleString()} {filtered.length === 1 ? 'asset' : 'assets'}</span>{scanning ? <span className="accent">Scanning…</span> : <span>{tree ? 'Folder tree' : 'Relative path ↑'}</span>}</div>
    <div ref={list} className="asset-list" role="listbox" aria-label="Assets" tabIndex={0} onScroll={event => setScroll(event.currentTarget.scrollTop)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selectRelative(event.key === 'ArrowDown' ? 1 : -1); } }}>
      {!rows.length ? <div className="browser-empty"><FolderOpen size={30} strokeWidth={1} /><p>{scanning ? 'Scanning folder…' : root ? assets.length ? 'No matching assets' : 'No recognized 3D files' : 'Open a folder to browse assets'}</p>{!root && <button className="secondary" onClick={onFolder}>Open Folder</button>}</div> : <div style={{ height: rows.length * rowHeight, position: 'relative' }}>{rows.slice(start, end).map((row, offset) => row.type === 'folder' ?
        <button key={`folder-${row.path}`} className="folder-row" style={{ top: (start + offset) * rowHeight, height: rowHeight, paddingLeft: 10 + row.depth * 14 }} onClick={() => setCollapsed(previous => { const next = new Set(previous); next.has(row.path) ? next.delete(row.path) : next.add(row.path); return next; })}>{collapsed.has(row.path) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<Folder size={14} /><span>{row.name}</span></button> :
        <div key={row.asset.path} className={`asset-row ${selected === row.asset.path ? 'selected' : ''} ${!IMPORTERS[row.asset.extension] ? 'unavailable' : ''} ${tree ? 'tree-row' : ''}`} role="option" aria-selected={selected === row.asset.path} title={row.asset.relative} style={{ top: (start + offset) * rowHeight, height: rowHeight, paddingLeft: 14 + row.depth * 14 }} onClick={() => { list.current?.focus(); onSelect(row.asset); }}>
          <div className="asset-icon">{IMPORTERS[row.asset.extension] ? <Box size={18} strokeWidth={1.35} /> : <FileBox size={18} strokeWidth={1.35} />}</div><div className="asset-copy"><span>{row.asset.name}</span>{!tree && <small>{IMPORTERS[row.asset.extension] ? row.asset.relative.split('/').slice(0, -1).join(' / ') || 'Root folder' : 'Preview unavailable'}</small>}</div>{preview === row.asset.path && <span className="preview-dot" title="Current preview" />}{!tree && <span className="extension">{row.asset.extension}</span>}
        </div>)}</div>}
    </div>
    {warnings.length > 0 && <details className="scan-warnings"><summary>{warnings.length} inaccessible {warnings.length === 1 ? 'location' : 'locations'}</summary>{warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}
    <div className="browser-footer"><span>↑ ↓ Browse FBX</span><span>{scanning ? 'Scanning' : 'Read only'}</span></div>
  </aside>;
}
