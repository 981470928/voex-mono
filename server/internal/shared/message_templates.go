package shared

import "fmt"

// MustBeMessage describes a field requirement without changing validation or status selection.
// MustBeMessage 描述字段要求，不改变校验逻辑或状态选择。
func MustBeMessage(field, requirement string) string {
	return fmt.Sprintf(MsgFieldMustBe, field, requirement)
}

func IntegerRangeMessage(field string, minimum, maximum int) string {
	return MustBeMessage(field, fmt.Sprintf(MsgIntegerRange, minimum, maximum))
}

func MaxCharactersMessage(field string, maximum int) string {
	return fmt.Sprintf(MsgMaxCharacters, field, maximum)
}

func CharacterRangeMessage(field string, minimum, maximum int) string {
	return fmt.Sprintf(MsgCharacterLimit, field, minimum, maximum)
}

func NotFoundMessage(resource string) string {
	return fmt.Sprintf(MsgResourceNotFound, resource)
}

func InvalidFormatMessage(field string) string {
	return fmt.Sprintf(MsgFieldFormatInvalid, field)
}

func SizeLimitMessage(subject string) string {
	return fmt.Sprintf(MsgSizeLimitExceeded, subject)
}

func MaxSizeMessage(subject string, maximum int64, unit string) string {
	return fmt.Sprintf(MsgMaxSize, subject, maximum, unit)
}
