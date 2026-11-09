import { PLAN_NAME_MAX_LENGTH } from '../store/persistence'
import { NameDialog } from './NameDialog'

export function PlanNameDialog({ initialName, onSubmit, onClose }: { initialName: string; onSubmit: (name: string) => void; onClose: () => void }) {
  return (
    <NameDialog
      title="Rename plan"
      label="Plan name"
      submitLabel="Rename"
      initialName={initialName}
      maxLength={PLAN_NAME_MAX_LENGTH}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}
