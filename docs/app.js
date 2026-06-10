/**
 * Radio Classics Schedule - Application JavaScript
 * Handles schedule rendering, search, and current time highlighting
 */

(function() {
  'use strict';

  // DOM Elements
  const scheduleBody = document.getElementById('schedule-body');
  const weekRange = document.getElementById('week-range');
  const whatsOnNow = document.getElementById('whats-on-now');
  const comingUp = document.getElementById('coming-up');
  const lastUpdated = document.getElementById('last-updated');
  const showSearch = document.getElementById('show-search');
  const noResults = document.getElementById('no-results');
  const clearSearchBtn = document.getElementById('clear-search');
  const errorMessage = document.getElementById('error-message');
  const errorText = document.getElementById('error-text');

  // State
  let scheduleData = null;
  let currentSearchTerm = '';

  // Constants
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const SCHEDULE_URL = 'schedule.json?v=' + Date.now();
  const EASTERN_TIMEZONE = 'America/New_York';

  /**
   * Get current time in Eastern timezone
   */
  function getEasternTime() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: EASTERN_TIMEZONE,
      weekday: 'long',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });

    const parts = formatter.formatToParts(now);
    const day = parts.find(p => p.type === 'weekday')?.value || '';
    const hours = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

    return {
      day: day,
      hours: hours,
      minutes: minutes,
      totalMinutes: hours * 60 + minutes
    };
  }

  /**
   * Initialize the application
   */
  function init() {
    // Always use dark theme
    document.documentElement.setAttribute('data-theme', 'dark');

    setupEventListeners();
    hideInstallTipIfStandalone();
    loadSchedule();

    // Update "what's on now" every minute
    setInterval(updateWhatsOnNow, 60000);
  }

  /**
   * Hide the "add to home screen" tip when the page is already running as an
   * installed app. CSS handles this via the display-mode media query; this
   * also covers iOS Safari's legacy navigator.standalone flag.
   */
  function hideInstallTipIfStandalone() {
    const installTip = document.getElementById('install-tip');
    if (!installTip) return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    if (isStandalone) {
      installTip.hidden = true;
    }
  }

  /**
   * Set up event listeners
   */
  function setupEventListeners() {
    showSearch.addEventListener('input', debounce(handleSearch, 300));
    clearSearchBtn.addEventListener('click', clearSearch);

    // Click "now playing" or a "coming up" entry to jump to that slot in the table
    whatsOnNow.addEventListener('click', handleNowPlayingClick);
    whatsOnNow.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleNowPlayingClick();
      }
    });
    comingUp.addEventListener('click', handleComingUpClick);

    // Keyboard shortcut: Escape to clear search
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && currentSearchTerm) {
        clearSearch();
        showSearch.focus();
      }
    });
  }

  /**
   * Scroll the table cell for a given day/time into view and briefly flash it.
   */
  function scrollToSlot(day, time) {
    if (!day || !time) return;

    const normalizedTime = normalizeTime(time);
    const cells = document.querySelectorAll(`#schedule-table td[data-day="${day}"]`);

    let target = null;
    cells.forEach(cell => {
      if (normalizeTime(cell.dataset.time) === normalizedTime) {
        target = cell;
      }
    });
    if (!target) return;

    const prefersReducedMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    target.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'center'
    });

    // Restart the flash animation even if the same cell is clicked twice
    target.classList.remove('slot-flash');
    void target.offsetWidth;
    target.classList.add('slot-flash');
    target.addEventListener('animationend', function handler() {
      target.classList.remove('slot-flash');
      target.removeEventListener('animationend', handler);
    });
  }

  /**
   * Jump to the currently playing show in the table.
   */
  function handleNowPlayingClick() {
    scrollToSlot(whatsOnNow.dataset.day, whatsOnNow.dataset.time);
  }

  /**
   * Jump to a "coming up" show when its entry is clicked.
   */
  function handleComingUpClick(e) {
    const btn = e.target.closest('.coming-up-jump');
    if (!btn) return;
    scrollToSlot(btn.dataset.day, btn.dataset.time);
  }

  /**
   * Load schedule data from JSON file
   */
  async function loadSchedule() {
    try {
      const response = await fetch(SCHEDULE_URL);
      if (!response.ok) {
        throw new Error('Failed to load schedule');
      }
      scheduleData = await response.json();

      if (scheduleData.error) {
        showError(scheduleData.error);
      }

      renderSchedule();
      updateWeekRange();
      updateTableHeaders();
      updateLastUpdated();
      updateWhatsOnNow();
      highlightToday();
    } catch (error) {
      console.error('Error loading schedule:', error);
      showError('Unable to load schedule. Please try again later.');
    }
  }

  /**
   * Render the schedule table
   */
  function renderSchedule() {
    if (!scheduleData || !scheduleData.schedule) {
      scheduleBody.innerHTML = '<tr><td colspan="8" class="loading-message">No schedule data available</td></tr>';
      return;
    }

    const timeSlots = collectTimeSlots();

    if (timeSlots.length === 0) {
      scheduleBody.innerHTML = '<tr><td colspan="8" class="loading-message">No shows scheduled</td></tr>';
      return;
    }

    let html = '';
    timeSlots.forEach(time => {
      html += '<tr>';
      html += `<td>${escapeHtml(time)}</td>`;

      DAYS.forEach(day => {
        const daySchedule = scheduleData.schedule.find(d => d.day === day);
        const slot = daySchedule?.slots?.find(s => normalizeTime(s.time) === normalizeTime(time));
        const showName = slot ? slot.show : '';
        html += `<td data-day="${day}" data-time="${time}">${escapeHtml(showName)}</td>`;
      });

      html += '</tr>';
    });

    scheduleBody.innerHTML = html;
  }

  /**
   * Collect all unique time slots from the schedule
   */
  function collectTimeSlots() {
    const times = new Set();

    if (scheduleData?.schedule) {
      scheduleData.schedule.forEach(day => {
        if (day.slots) {
          day.slots.forEach(slot => {
            times.add(normalizeTime(slot.time));
          });
        }
      });
    }

    return Array.from(times).sort((a, b) => {
      return timeToMinutes(a) - timeToMinutes(b);
    });
  }

  /**
   * Normalize time string for comparison
   */
  function normalizeTime(time) {
    if (!time) return '';
    return time.toUpperCase().trim()
      .replace(/\s+/g, ' ')
      .replace(':00', '');
  }

  /**
   * Convert time string to minutes for sorting
   */
  function timeToMinutes(timeStr) {
    if (!timeStr) return 0;

    const upper = timeStr.toUpperCase();
    const isPM = upper.includes('PM');
    const isAM = upper.includes('AM');

    const cleaned = upper.replace(/[AP]M/g, '').trim();
    const parts = cleaned.split(':');

    let hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;

    if (isPM && hours !== 12) {
      hours += 12;
    } else if (isAM && hours === 12) {
      hours = 0;
    }

    return hours * 60 + minutes;
  }

  /**
   * Update the week range display
   */
  function updateWeekRange() {
    if (!scheduleData) return;

    const start = scheduleData.week_start;
    const end = scheduleData.week_end;

    if (start && end) {
      const startDate = new Date(start + 'T00:00:00');
      const endDate = new Date(end + 'T00:00:00');

      const options = { month: 'long', day: 'numeric', year: 'numeric' };
      const startStr = startDate.toLocaleDateString('en-US', options);
      const endStr = endDate.toLocaleDateString('en-US', options);

      weekRange.textContent = `Week of ${startStr} - ${endStr}`;
    } else {
      weekRange.textContent = 'Current Week Schedule';
    }
  }

  /**
   * Update table headers with dates
   * The schedule week runs Monday-Sunday, with week_start being Monday
   */
  function updateTableHeaders() {
    if (!scheduleData?.week_start) return;

    const weekStart = new Date(scheduleData.week_start + 'T00:00:00');

    // Days from Monday (week_start) to each day
    const dayOffsets = {
      'Monday': 0,
      'Tuesday': 1,
      'Wednesday': 2,
      'Thursday': 3,
      'Friday': 4,
      'Saturday': 5,
      'Sunday': 6
    };

    const headers = document.querySelectorAll('#schedule-header th[data-day]');
    headers.forEach(th => {
      const dayName = th.dataset.day;
      const offset = dayOffsets[dayName];

      if (offset !== undefined) {
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + offset);

        const dateStr = dayDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        });

        th.innerHTML = `${dayName}<span class="header-date">${dateStr}</span>`;
      }
    });
  }

  /**
   * Update the last updated timestamp
   */
  function updateLastUpdated() {
    if (!scheduleData?.last_updated) return;

    const date = new Date(scheduleData.last_updated);
    const options = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    };

    lastUpdated.textContent = date.toLocaleDateString('en-US', options);
    lastUpdated.setAttribute('datetime', scheduleData.last_updated);
  }

  /**
   * Update the "What's on now" display and upcoming shows
   */
  function updateWhatsOnNow() {
    if (!scheduleData?.schedule) {
      whatsOnNow.textContent = '';
      clearNowPlayingClickable();
      comingUp.innerHTML = '';
      return;
    }

    const et = getEasternTime();
    const currentDay = et.day;
    const currentMinutes = et.totalMinutes;

    const daySchedule = scheduleData.schedule.find(d => d.day === currentDay);
    if (!daySchedule?.slots || daySchedule.slots.length === 0) {
      whatsOnNow.textContent = '';
      clearNowPlayingClickable();
      comingUp.innerHTML = '';
      return;
    }

    let currentShow = null;
    let currentShowTime = '';
    let currentShowIndex = -1;

    for (let i = 0; i < daySchedule.slots.length; i++) {
      const slot = daySchedule.slots[i];
      const slotMinutes = timeToMinutes(slot.time);
      if (slotMinutes <= currentMinutes) {
        currentShow = slot.show;
        currentShowTime = slot.time;
        currentShowIndex = i;
      }
    }

    if (currentShow) {
      whatsOnNow.textContent = `[NOW PLAYING] ${currentShow} (started at ${currentShowTime} ET)`;
      setNowPlayingClickable(currentDay, currentShowTime);
      highlightCurrentSlot(currentDay, currentShowTime);

      const upcomingShows = [];
      for (let i = currentShowIndex + 1; i < daySchedule.slots.length && upcomingShows.length < 3; i++) {
        upcomingShows.push(daySchedule.slots[i]);
      }

      if (upcomingShows.length > 0) {
        let html = '<p class="coming-up-label">Coming Up:</p><ul class="coming-up-list">';
        upcomingShows.forEach(slot => {
          html += `<li><button type="button" class="coming-up-jump" ` +
                  `data-day="${escapeHtml(currentDay)}" data-time="${escapeHtml(slot.time)}" ` +
                  `title="Jump to this show in the schedule below">` +
                  `<span class="coming-up-time">${escapeHtml(slot.time)}</span> ${escapeHtml(slot.show)}` +
                  `</button></li>`;
        });
        html += '</ul>';
        comingUp.innerHTML = html;
      } else {
        comingUp.innerHTML = '';
      }
    } else {
      whatsOnNow.textContent = '';
      clearNowPlayingClickable();
      comingUp.innerHTML = '';
    }
  }

  /**
   * Make the "now playing" banner behave as a button that jumps to the
   * current slot. Stores the target on data attributes for the click handler.
   */
  function setNowPlayingClickable(day, time) {
    whatsOnNow.dataset.day = day;
    whatsOnNow.dataset.time = time;
    whatsOnNow.classList.add('clickable');
    whatsOnNow.setAttribute('role', 'button');
    whatsOnNow.setAttribute('tabindex', '0');
    whatsOnNow.setAttribute('title', 'Jump to this show in the schedule below');
  }

  /**
   * Remove the clickable behavior from the "now playing" banner (e.g. overnight
   * when nothing is on).
   */
  function clearNowPlayingClickable() {
    delete whatsOnNow.dataset.day;
    delete whatsOnNow.dataset.time;
    whatsOnNow.classList.remove('clickable');
    whatsOnNow.removeAttribute('role');
    whatsOnNow.removeAttribute('tabindex');
    whatsOnNow.removeAttribute('title');
  }

  /**
   * Highlight today's column
   */
  function highlightToday() {
    const et = getEasternTime();
    const today = et.day;

    const headers = document.querySelectorAll('#schedule-table th');
    headers.forEach((th, index) => {
      if (index > 0 && DAYS[index - 1] === today) {
        th.classList.add('today-column');
      }
    });

    const cells = document.querySelectorAll(`#schedule-table td[data-day="${today}"]`);
    cells.forEach(cell => cell.classList.add('today-column'));
  }

  /**
   * Highlight the current time slot
   */
  function highlightCurrentSlot(day, time) {
    document.querySelectorAll('.current-slot').forEach(el => {
      el.classList.remove('current-slot');
    });

    const normalizedTime = normalizeTime(time);
    const cells = document.querySelectorAll(`#schedule-table td[data-day="${day}"]`);
    cells.forEach(cell => {
      if (normalizeTime(cell.dataset.time) === normalizedTime) {
        cell.classList.add('current-slot');
      }
    });
  }

  /**
   * Handle search input
   */
  function handleSearch() {
    currentSearchTerm = showSearch.value.trim().toLowerCase();

    if (!currentSearchTerm) {
      clearSearchHighlights();
      showAllRows();
      noResults.hidden = true;
      return;
    }

    const rows = scheduleBody.querySelectorAll('tr');
    let hasVisibleRows = false;

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      let rowHasMatch = false;

      cells.forEach((cell, index) => {
        if (index === 0) return;

        const text = cell.textContent.toLowerCase();
        const hasMatch = text.includes(currentSearchTerm);

        if (hasMatch && cell.textContent.trim()) {
          rowHasMatch = true;
          const regex = new RegExp(`(${escapeRegex(currentSearchTerm)})`, 'gi');
          cell.innerHTML = cell.textContent.replace(regex, '<span class="search-match">$1</span>');
        } else {
          cell.innerHTML = escapeHtml(cell.textContent);
        }
      });

      if (rowHasMatch) {
        row.classList.remove('hidden-row');
        hasVisibleRows = true;
      } else {
        row.classList.add('hidden-row');
      }
    });

    noResults.hidden = hasVisibleRows;
  }

  /**
   * Clear search and show all rows
   */
  function clearSearch() {
    showSearch.value = '';
    currentSearchTerm = '';
    clearSearchHighlights();
    showAllRows();
    noResults.hidden = true;
  }

  /**
   * Clear search highlights from cells
   */
  function clearSearchHighlights() {
    document.querySelectorAll('.search-match').forEach(el => {
      el.outerHTML = el.textContent;
    });
  }

  /**
   * Show all table rows
   */
  function showAllRows() {
    scheduleBody.querySelectorAll('tr').forEach(row => {
      row.classList.remove('hidden-row');
    });
  }

  /**
   * Show error message
   */
  function showError(message) {
    errorText.textContent = message;
    errorMessage.hidden = false;
  }

  /**
   * Escape HTML special characters
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Escape special regex characters
   */
  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Debounce function to limit rapid calls
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
