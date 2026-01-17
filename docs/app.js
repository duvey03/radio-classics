/**
 * Radio Classics Schedule - Application JavaScript
 * Handles schedule rendering, search, theme toggle, and current time highlighting
 */

(function() {
  'use strict';

  // DOM Elements
  const scheduleBody = document.getElementById('schedule-body');
  const weekRange = document.getElementById('week-range');
  const whatsOnNow = document.getElementById('whats-on-now');
  const lastUpdated = document.getElementById('last-updated');
  const showSearch = document.getElementById('show-search');
  const themeToggle = document.getElementById('theme-toggle');
  const todayBtn = document.getElementById('today-btn');
  const noResults = document.getElementById('no-results');
  const clearSearchBtn = document.getElementById('clear-search');
  const errorMessage = document.getElementById('error-message');
  const errorText = document.getElementById('error-text');

  // State
  let scheduleData = null;
  let currentSearchTerm = '';

  // Constants
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const SCHEDULE_URL = 'schedule.json';
  const EASTERN_TIMEZONE = 'America/New_York';

  /**
   * Get current time in Eastern timezone
   * @returns {{day: string, hours: number, minutes: number, totalMinutes: number}}
   */
  function getEasternTime() {
    const now = new Date();
    // Format date parts in Eastern timezone
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
    loadThemePreference();
    setupEventListeners();
    loadSchedule();

    // Update "what's on now" every minute
    setInterval(updateWhatsOnNow, 60000);
  }

  /**
   * Set up event listeners
   */
  function setupEventListeners() {
    themeToggle.addEventListener('click', toggleTheme);
    todayBtn.addEventListener('click', scrollToToday);
    showSearch.addEventListener('input', debounce(handleSearch, 300));
    clearSearchBtn.addEventListener('click', clearSearch);

    // Keyboard shortcut: Escape to clear search
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && currentSearchTerm) {
        clearSearch();
        showSearch.focus();
      }
    });
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

    // Collect all unique time slots across all days
    const timeSlots = collectTimeSlots();

    if (timeSlots.length === 0) {
      scheduleBody.innerHTML = '<tr><td colspan="8" class="loading-message">No shows scheduled</td></tr>';
      return;
    }

    // Build the table rows
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

    // Sort times chronologically
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

    // Convert to 24-hour format
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
   * Update the "What's on now" display
   * Uses Eastern Time (ET) since that's the schedule's timezone
   */
  function updateWhatsOnNow() {
    if (!scheduleData?.schedule) {
      whatsOnNow.textContent = '';
      return;
    }

    const et = getEasternTime();
    const currentDay = et.day;
    const currentMinutes = et.totalMinutes;

    const daySchedule = scheduleData.schedule.find(d => d.day === currentDay);
    if (!daySchedule?.slots || daySchedule.slots.length === 0) {
      whatsOnNow.textContent = '';
      return;
    }

    // Find the current show (the one that started most recently before now)
    let currentShow = null;
    let currentShowTime = '';

    for (const slot of daySchedule.slots) {
      const slotMinutes = timeToMinutes(slot.time);
      if (slotMinutes <= currentMinutes) {
        currentShow = slot.show;
        currentShowTime = slot.time;
      }
    }

    if (currentShow) {
      whatsOnNow.textContent = `[NOW PLAYING] ${currentShow} (started at ${currentShowTime} ET)`;
      highlightCurrentSlot(currentDay, currentShowTime);
    } else {
      whatsOnNow.textContent = '';
    }
  }

  /**
   * Highlight today's column
   * Uses Eastern Time (ET) since that's the schedule's timezone
   */
  function highlightToday() {
    const et = getEasternTime();
    const today = et.day;

    // Highlight header
    const headers = document.querySelectorAll('#schedule-table th');
    headers.forEach((th, index) => {
      if (index > 0 && DAYS[index - 1] === today) {
        th.classList.add('today-column');
      }
    });

    // Highlight cells
    const cells = document.querySelectorAll(`#schedule-table td[data-day="${today}"]`);
    cells.forEach(cell => cell.classList.add('today-column'));
  }

  /**
   * Highlight the current time slot
   */
  function highlightCurrentSlot(day, time) {
    // Remove previous highlight
    document.querySelectorAll('.current-slot').forEach(el => {
      el.classList.remove('current-slot');
    });

    // Add new highlight
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
        // Skip time column (index 0)
        if (index === 0) return;

        const text = cell.textContent.toLowerCase();
        const hasMatch = text.includes(currentSearchTerm);

        if (hasMatch && cell.textContent.trim()) {
          rowHasMatch = true;
          // Highlight matching text
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
   * Scroll to today's column
   */
  function scrollToToday() {
    const todayCell = document.querySelector('.today-column');
    if (todayCell) {
      todayCell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      todayCell.focus();
    }
  }

  /**
   * Toggle dark/light theme
   */
  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', newTheme);
    themeToggle.setAttribute('aria-pressed', !isDark);
    themeToggle.textContent = isDark ? 'Dark Mode' : 'Light Mode';

    // Save preference
    localStorage.setItem('theme', newTheme);
  }

  /**
   * Load theme preference from localStorage
   */
  function loadThemePreference() {
    const savedTheme = localStorage.getItem('theme');

    // Check for system preference if no saved preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');

    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeToggle.setAttribute('aria-pressed', 'true');
      themeToggle.textContent = 'Light Mode';
    }
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
