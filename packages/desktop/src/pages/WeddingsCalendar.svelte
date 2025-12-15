<script lang="ts">
  /**
   * WeddingsCalendar - Calendar view of weddings
   * Follows Braun/Ulm functional minimalism
   */
  type Status = 'imported' | 'culling' | 'editing' | 'delivered' | 'archived';

  interface Wedding {
    id: string;
    display_name: string;
    wedding_date: string;
    status: Status;
  }

  interface Props {
    onnavigate?: (page: string, weddingId?: string) => void;
  }

  const { onnavigate }: Props = $props();

  let currentYear = $state(new Date().getFullYear());
  let currentMonth = $state(new Date().getMonth() + 1);
  let weddings = $state<Wedding[]>([]);
  let loading = $state(true);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  async function loadWeddings() {
    loading = true;
    try {
      weddings = await window.electronAPI.weddings.getForMonth(currentYear, currentMonth);
    } catch (e) {
      console.error('Failed to load weddings:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadWeddings();
  });

  function previousMonth() {
    if (currentMonth === 1) {
      currentMonth = 12;
      currentYear--;
    } else {
      currentMonth--;
    }
  }

  function nextMonth() {
    if (currentMonth === 12) {
      currentMonth = 1;
      currentYear++;
    } else {
      currentMonth++;
    }
  }

  function goToToday() {
    currentYear = new Date().getFullYear();
    currentMonth = new Date().getMonth() + 1;
  }

  interface CalendarDay {
    date: number;
    isCurrentMonth: boolean;
    isToday: boolean;
    weddings: Wedding[];
  }

  const calendarDays = $derived(() => {
    const days: CalendarDay[] = [];

    // First day of current month
    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const startDayOfWeek = firstDay.getDay();

    // Last day of current month
    const lastDay = new Date(currentYear, currentMonth, 0);
    const daysInMonth = lastDay.getDate();

    // Previous month days
    const prevMonthLastDay = new Date(currentYear, currentMonth - 1, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: prevMonthLastDay - i,
        isCurrentMonth: false,
        isToday: false,
        weddings: [],
      });
    }

    // Current month days
    const today = new Date();
    for (let date = 1; date <= daysInMonth; date++) {
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
      const isToday = today.getFullYear() === currentYear &&
                      today.getMonth() + 1 === currentMonth &&
                      today.getDate() === date;

      days.push({
        date,
        isCurrentMonth: true,
        isToday,
        weddings: weddings.filter(w => w.wedding_date === dateStr),
      });
    }

    // Next month days to fill grid
    const remainingDays = 42 - days.length;
    for (let date = 1; date <= remainingDays; date++) {
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        weddings: [],
      });
    }

    return days;
  });

  function handleWeddingClick(weddingId: string) {
    onnavigate?.('wedding-detail', weddingId);
  }

  const statusColors: Record<Status, string> = {
    imported: 'var(--status-imported-bg)',
    culling: 'var(--status-culling-bg)',
    editing: 'var(--status-editing-bg)',
    delivered: 'var(--status-delivered-bg)',
    archived: 'var(--status-archived-bg)',
  };
</script>

<div class="page">
  <header class="page-header">
    <h1>Calendar</h1>
    <div class="calendar-nav">
      <button class="btn btn-secondary" onclick={previousMonth}>Previous</button>
      <span class="calendar-nav__month">{monthNames[currentMonth - 1]} {currentYear}</span>
      <button class="btn btn-secondary" onclick={nextMonth}>Next</button>
      <button class="btn btn-secondary" onclick={goToToday}>Today</button>
    </div>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <div class="calendar-grid">
      <!-- Day headers -->
      {#each dayNames as day}
        <div class="calendar-day calendar-day--header">{day}</div>
      {/each}

      <!-- Calendar days -->
      {#each calendarDays() as day}
        <div
          class="calendar-day"
          class:calendar-day--other-month={!day.isCurrentMonth}
          class:calendar-day--today={day.isToday}
        >
          <span class="calendar-day__number">{day.date}</span>
          {#each day.weddings as wedding}
            <button
              class="calendar-wedding"
              style="background-color: {statusColors[wedding.status]}; color: var(--status-{wedding.status})"
              type="button"
              onclick={() => handleWeddingClick(wedding.id)}
            >
              {wedding.display_name}
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .calendar-nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .calendar-nav__month {
    font-size: var(--step-1);
    font-weight: 500;
    min-width: 160px;
    text-align: center;
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-muted);
  }
</style>
