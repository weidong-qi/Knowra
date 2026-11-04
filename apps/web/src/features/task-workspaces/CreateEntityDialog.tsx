import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button/Button';
import { TextField } from '../../components/ui/input';
import { Dialog, DialogBody, DialogFooter } from '../../components/ui/overlay';

export function CreateEntityDialog({ title, onCreate, onClose }: { title: string; onCreate(name: string, operationId: string): Promise<void>; onClose(): void }) {
  const request = useRef<{ name: string; operationId: string } | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <Dialog title={title} isOpen onOpenChange={open => { if (!open) onClose(); }} isPending={pending}>
    <DialogBody>
      <TextField label="名称" value={name} onChange={setName} autoFocus isRequired maxLength={160} />
      {error && <p role="alert">{error}</p>}
    </DialogBody>
    <DialogFooter><Button variant="ghost" onPress={onClose} isDisabled={pending}>取消</Button>
      <Button isDisabled={pending || !name.trim()} onPress={() => {
        setPending(true); setError('');
        if (request.current?.name !== name.trim()) request.current = { name: name.trim(), operationId: crypto.randomUUID() };
        void onCreate(name.trim(), request.current.operationId).then(onClose).catch(() => setError('创建失败，请重试。')).finally(() => setPending(false));
      }}>创建</Button></DialogFooter>
  </Dialog>;
}
