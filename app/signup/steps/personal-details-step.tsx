"use client"

import { FormField } from "../form-field"
import { FormSelect } from "../form-select"
import { COUNTRY_OPTIONS, type PersonalDetails } from "@/lib/signup/types"

interface PersonalDetailsStepProps {
  value: PersonalDetails
  onChange: (value: PersonalDetails) => void
}

function field<K extends keyof PersonalDetails>(
  value: PersonalDetails,
  onChange: (value: PersonalDetails) => void,
  key: K
) {
  return {
    value: value[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [key]: event.target.value }),
  }
}

export function PersonalDetailsStep({ value, onChange }: PersonalDetailsStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
          Step 2
        </p>
        <h1 className="mt-2 font-display text-display-l text-ink">Your details</h1>
        <p className="mt-3 max-w-sm text-base text-ink/60">
          This is your personal profile &mdash; kept separate from any
          club&apos;s own address or contact details.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          id="firstName"
          label="First name"
          autoComplete="given-name"
          required
          {...field(value, onChange, "firstName")}
        />
        <FormField
          id="surname"
          label="Surname"
          autoComplete="family-name"
          required
          {...field(value, onChange, "surname")}
        />
      </div>

      <FormField
        id="dateOfBirth"
        label="Date of birth"
        type="date"
        autoComplete="bday"
        wrapperClassName="max-w-xs"
        {...field(value, onChange, "dateOfBirth")}
      />

      <div className="mt-2 border-t border-ink/10 pt-6">
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">
          Your address <span className="normal-case text-ink/35">(optional)</span>
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <FormField
            id="addressLine1"
            label="Address line 1"
            autoComplete="address-line1"
            {...field(value, onChange, "addressLine1")}
          />
          <FormField
            id="addressLine2"
            label="Address line 2"
            autoComplete="address-line2"
            {...field(value, onChange, "addressLine2")}
          />
          <FormField
            id="addressLine3"
            label="Address line 3"
            {...field(value, onChange, "addressLine3")}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id="town"
              label="Town"
              autoComplete="address-level2"
              {...field(value, onChange, "town")}
            />
            <FormField
              id="county"
              label="County"
              {...field(value, onChange, "county")}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormSelect
              id="country"
              label="Country"
              autoComplete="country-name"
              value={value.country}
              onChange={(event) => onChange({ ...value, country: event.target.value })}
            >
              <option value="">Select&hellip;</option>
              {COUNTRY_OPTIONS.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </FormSelect>
            <FormField
              id="postcode"
              label="Postcode"
              autoComplete="postal-code"
              {...field(value, onChange, "postcode")}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
