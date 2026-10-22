import { readableCopy } from '../lib/readable-copy';
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertCircle,
  ArrowUpRight,
  FileUp,
  Inbox,
  LoaderCircle,
  X,
  type LucideIcon,
} from 'lucide-react';

export function Button({
  children,
  className = '',
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function LoadingState({ label = 'Loading your workspace…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={22} />
      {label}
    </div>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="error-message" role="alert">
      <AlertCircle size={18} />
      <span>{readableCopy(message)}</span>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={25} />
      </span>
      <h3>{readableCopy(title)}</h3>
      <p>{readableCopy(description)}</p>
      {action}
    </div>
  );
}
export function StatisticCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>{readableCopy(title)}</Dialog.Title>
          <Dialog.Description>{readableCopy(description)}</Dialog.Description>
          <Dialog.Close className="dialog-close" aria-label="Close dialog" disabled={busy}>
            <X size={20} />
          </Dialog.Close>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={onConfirm} disabled={busy}>
              {busy ? 'Signing out…' : 'Confirm'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export interface TableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
}
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
}: {
  rows: T[];
  columns: TableColumn<T>[];
  rowKey: (row: T) => string;
  caption: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column.key}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render(row)}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>No records yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function FileUploader({
  onSelect,
  maxMb = 10,
  accept = '.pdf,.docx',
  disabled = false,
}: {
  onSelect: (file: File | null) => void;
  maxMb?: number;
  accept?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <div>
      <label htmlFor={id} className="file-uploader">
        <FileUp size={24} />
        <strong>{name || 'Choose a document'}</strong>
        <span>
          {accept.replaceAll('.', '').toUpperCase()} · up to {maxMb} MB
        </span>
        <input
          id={id}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            setError('');
            setName('');
            onSelect(null);
            if (!file) return;
            const extensions = accept.split(',').map((item) => item.trim().toLowerCase());
            if (!extensions.some((extension) => file.name.toLowerCase().endsWith(extension))) {
              setError('Choose a supported document type.');
              event.target.value = '';
              return;
            }
            if (file.size === 0) {
              setError('The document is empty. Choose a file with content.');
              event.target.value = '';
              return;
            }
            if (file.size > maxMb * 1024 * 1024) {
              setError(`The file must be ${maxMb} MB or smaller.`);
              event.target.value = '';
              return;
            }
            setName(file.name);
            onSelect(file);
          }}
        />
      </label>
      {error && <ErrorMessage message={error} />}
    </div>
  );
}
export function TextLinkIcon() {
  return <ArrowUpRight size={16} aria-hidden="true" />;
}
