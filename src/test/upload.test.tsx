import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileUploader } from '../components/ui';
it('rejects invalid file types and permits a valid document', async () => {
  const onSelect = vi.fn();
  render(<FileUploader onSelect={onSelect} />);
  const input = screen.getByLabelText(/Choose a document/);
  const user = userEvent.setup({ applyAccept: false });
  await user.upload(input, new File(['bad'], 'script.exe', { type: 'application/octet-stream' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a supported document type.');
  expect(onSelect).toHaveBeenLastCalledWith(null);
  const pdf = new File(['document'], 'proposal.pdf', { type: 'application/pdf' });
  await user.upload(input, pdf);
  expect(onSelect).toHaveBeenLastCalledWith(pdf);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('rejects documents over the configured size limit', async () => {
  const onSelect = vi.fn();
  render(<FileUploader onSelect={onSelect} maxMb={1} />);
  await userEvent.upload(
    screen.getByLabelText(/Choose a document/),
    new File([new Uint8Array(1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' }),
  );
  expect(screen.getByRole('alert')).toHaveTextContent('The file must be 1 MB or smaller.');
  expect(onSelect).toHaveBeenLastCalledWith(null);
});
