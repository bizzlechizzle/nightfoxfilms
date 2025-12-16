<script lang="ts">
  /**
   * Calendar - Monthly view of wedding projects
   * Follows Braun/Ulm functional minimalism
   */
  import type { Couple, CoupleStatus } from '@nightfox/core';

  interface Props {
    onnavigate?: (page: string, coupleId?: number) => void;
  }

  const { onnavigate }: Props = $props();

  let currentYear = $state(new Date().getFullYear());
  let currentMonth = $state(new Date().getMonth() + 1);
  let couples = $state<Couple[]>([]);
  let loading = $state(true);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const statusColors: Record<CoupleStatus, string> = {
    booked: 'var(--color-status-info)',
    shot: 'var(--color-status-warning)',
    ingested: 'var(--color-status-warning)',
    editing: 'var(--color-status-warning)',
    delivered: 'var(--color-status-success)',
    archived: 'var(--color-text-muted)',
  };

  async function loadCouples() {
    loading = true;
    try {
      couples = await window.electronAPI.couples.getForMonth(currentYear, currentMonth);
    } catch (e) {
      console.error('Failed to load couples for month:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadCouples();
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
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth() + 1;
  }

  function handleCoupleClick(coupleId: number) {
    onnavigate?.('couple-detail', coupleId);
  }

  // Generate calendar days
  const calendarDays = $derived(() => {
    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const lastDay = new Date(currentYear, currentMonth, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();

    const days: Array<{ day: number | null; couples: Couple[] }> = [];

    // Empty slots before first day
    for (let i = 0; i < startingDay; i++) {
      days.push({ day: null, couples: [] });
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayCouples = couples.filter(c => c.wedding_date === dateStr);
      days.push({ day, couples: dayCouples });
    }

    return days;
  });
</script>

<div class="page">
  <header class="page-header">
    <h1>Calendar</h1>
    <div class="month-nav">
      <button class="btn btn-secondary" onclick={previousMonth}>Previous</button>
      <span class="month-nav__label">{monthNames[currentMonth - 1]} {currentYear}</span>
      <button class="btn btn-secondary" onclick={nextMonth}>Next</button>
      <button class="btn btn-secondary" onclick={goToToday}>Today</button>
    </div>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <div class="calendar">
      <div class="calendar-header">
        <span>Sun</span>
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
      </div>
      <div class="calendar-grid">
        {#each calendarDays() as { day, couples: dayCouples }}
          <div class="calendar-day" class:empty={day === null}>
            {#if day !== null}
              <span class="calendar-day__number">{day}</span>
              {#each dayCouples as couple}
                <button
                  class="calendar-event"
                  style="border-left-color: {statusColors[couple.status]}"
                  onclick={() => handleCoupleClick(couple.id)}
                >
                  {couple.name}
                </button>
              {/each}
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .month-nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .month-nav__label {
    font-size: var(--step-1);
    font-weight: 500;
    min-width: 180px;
    text-align: center;
  }

  .calendar {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    overflow: hidden;
  }

  .calendar-header {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    background-color: var(--color-bg-alt);
    border-bottom: 1px solid var(--color-border);
  }

  .calendar-header span {
    padding: 0.75rem;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }

  .calendar-day {
    min-height: 100px;
    padding: 0.5rem;
    border-right: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
  }

  .calendar-day:nth-child(7n) {
    border-right: none;
  }

  .calendar-day.empty {
    background-color: var(--color-bg-alt);
  }

  .calendar-day__number {
    display: block;
    font-size: var(--step--1);
    font-weight: 500;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }

  .calendar-event {
    display: block;
    width: 100%;
    padding: 0.25rem 0.5rem;
    margin-bottom: 0.25rem;
    background-color: var(--color-bg);
    border: none;
    border-left: 3px solid;
    border-radius: 2px;
    font-size: var(--step--1);
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .calendar-event:hover {
    background-color: var(--color-bg-alt);
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-muted);
  }

  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    font-size: var(--step--1);
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .btn-secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .btn-secondary:hover {
    background: var(--color-bg-alt);
  }
</style>
