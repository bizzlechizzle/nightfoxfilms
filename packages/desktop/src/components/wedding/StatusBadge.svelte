<script lang="ts">
  /**
   * StatusBadge - Displays wedding workflow status
   * Follows Braun/Ulm functional minimalism
   */
  type Status = 'imported' | 'culling' | 'editing' | 'delivered' | 'archived';

  interface Props {
    status: Status;
  }

  const { status }: Props = $props();

  const labels: Record<Status, string> = {
    imported: 'Imported',
    culling: 'Culling',
    editing: 'Editing',
    delivered: 'Delivered',
    archived: 'Archived',
  };
</script>

<span class="status-badge status-badge--{status}">
  {labels[status]}
</span>
