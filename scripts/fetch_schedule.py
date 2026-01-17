"""
Radio Classics Schedule Fetcher
Scrapes gregbellmedia.com for the weekly SiriusXM Channel 148 schedule,
parses the Excel file, and outputs JSON for the website.
"""

import json
import logging
import re
import sys
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Optional

import requests
from bs4 import BeautifulSoup
from openpyxl import load_workbook

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
SCHEDULE_SOURCE_URL = "https://gregbellmedia.com/"
OUTPUT_PATH = Path(__file__).parent.parent / "docs" / "schedule.json"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def fetch_page(url: str) -> Optional[str]:
    """Fetch HTML content from a URL."""
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=30
        )
        response.raise_for_status()
        return response.text
    except requests.RequestException as e:
        logger.error(f"Failed to fetch {url}: {e}")
        return None


def find_excel_url(html: str) -> Optional[str]:
    """Extract the Excel schedule URL from the page HTML."""
    soup = BeautifulSoup(html, 'html.parser')

    # Look for links containing Excel file patterns
    # Pattern: RC_[date-range]-Excel-Version.xlsx
    excel_pattern = re.compile(r'RC_.*Excel.*\.xlsx', re.IGNORECASE)

    for link in soup.find_all('a', href=True):
        href = link['href']
        if excel_pattern.search(href):
            logger.info(f"Found Excel URL: {href}")
            return href

    # Also check for .xlsx links in general
    for link in soup.find_all('a', href=True):
        href = link['href']
        if href.endswith('.xlsx'):
            logger.info(f"Found Excel URL (fallback): {href}")
            return href

    logger.error("No Excel file URL found on the page")
    return None


def download_excel(url: str) -> Optional[BytesIO]:
    """Download Excel file and return as BytesIO."""
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=60
        )
        response.raise_for_status()
        logger.info(f"Downloaded Excel file ({len(response.content)} bytes)")
        return BytesIO(response.content)
    except requests.RequestException as e:
        logger.error(f"Failed to download Excel file: {e}")
        return None


def parse_time(time_str: str) -> str:
    """Normalize time string to consistent format."""
    if not time_str:
        return ""

    time_str = str(time_str).strip().upper()

    # Handle various time formats
    # Remove spaces around colons
    time_str = re.sub(r'\s*:\s*', ':', time_str)

    # Try to parse and reformat
    for fmt in ['%I:%M %p', '%I:%M%p', '%H:%M', '%I %p', '%I%p']:
        try:
            parsed = datetime.strptime(time_str, fmt)
            return parsed.strftime('%-I:%M %p').replace(':00', '')
        except ValueError:
            continue

    return time_str


def parse_excel_schedule(excel_data: BytesIO) -> dict:
    """Parse the Excel schedule into structured JSON format."""
    wb = load_workbook(excel_data, data_only=True)
    ws = wb.active

    schedule_data = {
        "week_start": "",
        "week_end": "",
        "last_updated": datetime.utcnow().isoformat() + "Z",
        "schedule": []
    }

    # The Excel format typically has:
    # - Header row with days/dates
    # - Time slots in first column
    # - Show names in subsequent columns

    # Find the header row (contains day names)
    header_row = None
    day_columns = {}
    days_of_week = ['sunday', 'monday', 'tuesday', 'wednesday',
                    'thursday', 'friday', 'saturday']

    for row_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=20), start=1):
        row_values = [str(cell.value).lower() if cell.value else '' for cell in row]

        # Check if this row contains day names
        found_days = 0
        for col_idx, val in enumerate(row_values):
            for day in days_of_week:
                if day in val:
                    found_days += 1
                    break

        if found_days >= 3:  # Found at least 3 day names
            header_row = row_idx
            for col_idx, val in enumerate(row_values):
                for day in days_of_week:
                    if day in val:
                        day_columns[col_idx] = day.capitalize()
                        break
            break

    if not header_row:
        logger.warning("Could not find header row with day names, using default structure")
        # Create a default weekly structure
        return create_default_schedule()

    logger.info(f"Found header at row {header_row} with columns: {day_columns}")

    # Parse time slots and shows
    time_column = 0  # Assume times are in first column
    day_schedules = {day: [] for day in day_columns.values()}

    for row in ws.iter_rows(min_row=header_row + 1, max_row=ws.max_row):
        time_cell = row[time_column].value
        if not time_cell:
            continue

        time_str = parse_time(str(time_cell))
        if not time_str or not any(c.isdigit() for c in time_str):
            continue

        for col_idx, day_name in day_columns.items():
            if col_idx < len(row):
                cell_value = row[col_idx].value
                if cell_value:
                    show_name = str(cell_value).strip()
                    if show_name and show_name.lower() not in ['none', 'n/a', '-']:
                        day_schedules[day_name].append({
                            "time": time_str,
                            "show": show_name,
                            "episode": ""
                        })

    # Extract date range from the workbook if possible
    week_start, week_end = extract_date_range(ws)
    schedule_data["week_start"] = week_start
    schedule_data["week_end"] = week_end

    # Build final schedule structure
    for day in ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
                'Thursday', 'Friday', 'Saturday']:
        if day in day_schedules:
            schedule_data["schedule"].append({
                "day": day,
                "date": "",  # Will be filled by frontend based on week_start
                "slots": sorted(day_schedules[day],
                              key=lambda x: parse_time_for_sort(x["time"]))
            })

    return schedule_data


def parse_time_for_sort(time_str: str) -> int:
    """Convert time string to minutes for sorting."""
    try:
        time_str = time_str.upper().strip()

        # Handle AM/PM
        is_pm = 'PM' in time_str
        time_str = time_str.replace('AM', '').replace('PM', '').strip()

        parts = time_str.split(':')
        hours = int(parts[0])
        minutes = int(parts[1]) if len(parts) > 1 else 0

        # Convert to 24-hour for sorting
        if is_pm and hours != 12:
            hours += 12
        elif not is_pm and hours == 12:
            hours = 0

        return hours * 60 + minutes
    except (ValueError, IndexError):
        return 0


def extract_date_range(ws) -> tuple[str, str]:
    """Try to extract the date range from the worksheet."""
    # Look in first few rows for date patterns
    date_pattern = re.compile(r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})')

    for row in ws.iter_rows(min_row=1, max_row=10):
        for cell in row:
            if cell.value:
                val = str(cell.value)
                matches = date_pattern.findall(val)
                if len(matches) >= 2:
                    # Found date range
                    start = matches[0]
                    end = matches[1]

                    year = int(start[2])
                    if year < 100:
                        year += 2000

                    start_date = f"{year}-{int(start[0]):02d}-{int(start[1]):02d}"

                    year = int(end[2])
                    if year < 100:
                        year += 2000
                    end_date = f"{year}-{int(end[0]):02d}-{int(end[1]):02d}"

                    return start_date, end_date

    # Default to current week
    today = datetime.now()
    # Find most recent Sunday
    days_since_sunday = (today.weekday() + 1) % 7
    week_start = today - timedelta(days=days_since_sunday)
    week_end = week_start + timedelta(days=6)

    return week_start.strftime("%Y-%m-%d"), week_end.strftime("%Y-%m-%d")


def create_default_schedule() -> dict:
    """Create a default/placeholder schedule structure."""
    today = datetime.now()
    days_since_sunday = (today.weekday() + 1) % 7
    week_start = today - timedelta(days=days_since_sunday)
    week_end = week_start + timedelta(days=6)

    return {
        "week_start": week_start.strftime("%Y-%m-%d"),
        "week_end": week_end.strftime("%Y-%m-%d"),
        "last_updated": datetime.utcnow().isoformat() + "Z",
        "schedule": [
            {"day": day, "date": "", "slots": []}
            for day in ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
                       'Thursday', 'Friday', 'Saturday']
        ],
        "error": "Could not parse schedule. Please check back later."
    }


def save_schedule(schedule: dict, output_path: Path) -> bool:
    """Save schedule to JSON file."""
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(schedule, f, indent=2, ensure_ascii=False)
        logger.info(f"Schedule saved to {output_path}")
        return True
    except IOError as e:
        logger.error(f"Failed to save schedule: {e}")
        return False


def main() -> int:
    """Main entry point."""
    logger.info("Starting Radio Classics schedule fetch")

    # Step 1: Fetch the source page
    html = fetch_page(SCHEDULE_SOURCE_URL)
    if not html:
        logger.error("Failed to fetch source page")
        schedule = create_default_schedule()
        schedule["error"] = "Could not fetch schedule source page"
        save_schedule(schedule, OUTPUT_PATH)
        return 1

    # Step 2: Find the Excel URL
    excel_url = find_excel_url(html)
    if not excel_url:
        logger.error("Could not find Excel file URL")
        schedule = create_default_schedule()
        schedule["error"] = "Could not find schedule file"
        save_schedule(schedule, OUTPUT_PATH)
        return 1

    # Step 3: Download the Excel file
    excel_data = download_excel(excel_url)
    if not excel_data:
        logger.error("Failed to download Excel file")
        schedule = create_default_schedule()
        schedule["error"] = "Could not download schedule file"
        save_schedule(schedule, OUTPUT_PATH)
        return 1

    # Step 4: Parse the schedule
    try:
        schedule = parse_excel_schedule(excel_data)
        logger.info(f"Parsed schedule for week {schedule['week_start']} to {schedule['week_end']}")
    except Exception as e:
        logger.error(f"Failed to parse Excel file: {e}")
        schedule = create_default_schedule()
        schedule["error"] = f"Could not parse schedule: {str(e)}"
        save_schedule(schedule, OUTPUT_PATH)
        return 1

    # Step 5: Save the schedule
    if not save_schedule(schedule, OUTPUT_PATH):
        return 1

    logger.info("Schedule fetch completed successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())
