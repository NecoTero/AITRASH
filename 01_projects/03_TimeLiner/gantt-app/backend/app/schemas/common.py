from datetime import date

from pydantic import BaseModel, field_validator


class DateRange(BaseModel):
    start_date: date
    end_date: date

    @field_validator("end_date")
    @classmethod
    def end_date_must_not_precede_start(cls, end_date: date, info) -> date:
        start_date = info.data.get("start_date")
        if start_date and end_date < start_date:
            raise ValueError("end_date must not be earlier than start_date")
        return end_date

