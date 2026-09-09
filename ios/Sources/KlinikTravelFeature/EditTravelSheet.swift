import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * Booking the trip.
 *
 * Dates are optional and stay optional: a coordinator knows the flight before
 * the hotel and the hotel before the interpreter, and a form that demands all
 * of it at once is a form filled in on paper first. Each date has a switch
 * beside it so "not booked yet" and "booked for today" are different states —
 * a picker defaulting to today would quietly claim the second.
 */
struct EditTravelSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let plan: TravelPlan?
    let submit: (TravelPlanEdit) async -> Void

    @State private var arrivalFlight: String
    @State private var departureFlight: String
    @State private var hotelName: String
    @State private var hotelAddress: String
    @State private var greeterName: String
    @State private var greeterPhone: String
    @State private var transferNote: String
    @State private var interpreterName: String
    @State private var interpreterLanguage: String
    @State private var interpreterPhone: String
    @State private var notes: String

    @State private var arrival: OptionalDate
    @State private var departure: OptionalDate
    @State private var checkIn: OptionalDate
    @State private var checkOut: OptionalDate

    @State private var busy = false

    init(plan: TravelPlan?, submit: @escaping (TravelPlanEdit) async -> Void) {
        self.plan = plan
        self.submit = submit
        _arrivalFlight = State(initialValue: plan?.arrivalFlight ?? "")
        _departureFlight = State(initialValue: plan?.departureFlight ?? "")
        _hotelName = State(initialValue: plan?.hotelName ?? "")
        _hotelAddress = State(initialValue: plan?.hotelAddress ?? "")
        _greeterName = State(initialValue: plan?.greeterName ?? "")
        _greeterPhone = State(initialValue: plan?.greeterPhone ?? "")
        _transferNote = State(initialValue: plan?.transferNote ?? "")
        _interpreterName = State(initialValue: plan?.interpreterName ?? "")
        _interpreterLanguage = State(initialValue: plan?.interpreterLanguage ?? "")
        _interpreterPhone = State(initialValue: plan?.interpreterPhone ?? "")
        _notes = State(initialValue: plan?.notes ?? "")
        _arrival = State(initialValue: OptionalDate(plan?.arrivalAt))
        _departure = State(initialValue: OptionalDate(plan?.departureAt))
        _checkIn = State(initialValue: OptionalDate(plan?.hotelCheckIn))
        _checkOut = State(initialValue: OptionalDate(plan?.hotelCheckOut))
    }

    var body: some View {
        FormScaffold(title: L10n.string("travel.title")) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xl) {
                section(L10n.string("travel.flights")) {
                    field(L10n.string("travel.arrivalFlight"), $arrivalFlight)
                    dateField(L10n.string("travel.arrivalAt"), $arrival, withTime: true)
                    field(L10n.string("travel.departureFlight"), $departureFlight)
                    dateField(L10n.string("travel.departureAt"), $departure, withTime: true)
                }

                section(L10n.string("travel.hotel")) {
                    field(L10n.string("travel.hotelName"), $hotelName)
                    field(L10n.string("travel.hotelAddress"), $hotelAddress)
                    dateField(L10n.string("travel.checkIn"), $checkIn, withTime: false)
                    dateField(L10n.string("travel.checkOut"), $checkOut, withTime: false)
                }

                section(L10n.string("travel.welcome")) {
                    field(L10n.string("travel.greeter"), $greeterName)
                    field(L10n.string("travel.greeterPhone"), $greeterPhone)
                    field(L10n.string("travel.transfer"), $transferNote)
                }

                section(L10n.string("travel.interpreter")) {
                    field(L10n.string("travel.interpreterName"), $interpreterName)
                    field(L10n.string("travel.interpreterLanguage"), $interpreterLanguage)
                    field(L10n.string("travel.interpreterPhone"), $interpreterPhone)
                }

                field(L10n.string("file.notes"), $notes)

                PrimaryButton(
                    title: L10n.string("common.save"),
                    isBusy: busy,
                    isEnabled: !busy
                ) {
                    busy = true
                    await submit(edit)
                    busy = false
                }

                Button(L10n.string("common.cancel")) { dismiss() }
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }

    private var edit: TravelPlanEdit {
        TravelPlanEdit(
            arrivalFlight: arrivalFlight.cleaned,
            arrivalAt: arrival.value,
            departureFlight: departureFlight.cleaned,
            departureAt: departure.value,
            hotelName: hotelName.cleaned,
            hotelAddress: hotelAddress.cleaned,
            hotelCheckIn: checkIn.value,
            hotelCheckOut: checkOut.value,
            greeterName: greeterName.cleaned,
            greeterPhone: greeterPhone.cleaned,
            transferNote: transferNote.cleaned,
            interpreterName: interpreterName.cleaned,
            interpreterLanguage: interpreterLanguage.cleaned,
            interpreterPhone: interpreterPhone.cleaned,
            notes: notes.cleaned
        )
    }

    @ViewBuilder
    private func section<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            Text(title)
                .font(Tokens.Typography.subheadingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .accessibilityAddTraits(.isHeader)

            content()
        }
    }

    private func field(_ label: String, _ text: Binding<String>) -> some View {
        LabelledField(
            label: label,
            text: text,
            isSecure: false,
            contentType: .plain,
            keyboard: .default
        )
    }

    private func dateField(
        _ label: String,
        _ date: Binding<OptionalDate>,
        withTime: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Toggle(label, isOn: date.isSet)
                .font(Tokens.Typography.calloutRelative)
                .frame(minHeight: Tokens.minimumTouchTarget)

            if date.wrappedValue.isSet {
                DatePicker(
                    label,
                    selection: date.date,
                    displayedComponents: withTime ? [.date, .hourAndMinute] : [.date]
                )
                .labelsHidden()
                .frame(minHeight: Tokens.minimumTouchTarget)
                .accessibilityLabel(label)
            }
        }
    }
}

/// A date that may not have been decided yet.
///
/// A plain `Date` cannot express "not booked": a picker defaulting to today
/// would quietly claim a flight lands this afternoon.
struct OptionalDate: Equatable {
    var isSet: Bool
    var date: Date

    init(_ value: Date?) {
        isSet = value != nil
        date = value ?? Date()
    }

    var value: Date? { isSet ? date : nil }
}

private extension String {
    /// Nil rather than an empty string, so a field somebody cleared is sent as
    /// cleared rather than as two quote marks.
    var cleaned: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)

        return trimmed.isEmpty ? nil : trimmed
    }
}
