package connection

import (
	"fmt"
	"io"

	"mobaxterm-clone/internal/config"

	"go.bug.st/serial"
)

// serialSession is our implementation of the Session interface for serial ports
type serialSession struct {
	port serial.Port
}

func (s *serialSession) Write(data []byte) (int, error) {
	return s.port.Write(data)
}

func (s *serialSession) Close() error {
	return s.port.Close()
}

func (s *serialSession) Resize(cols, rows int) error {
	// Not applicable for raw serial connections
	return nil
}

// connectSerial initiates a serial connection
func (m *Manager) connectSerial(cfg config.Config) (Session, error) {
	if cfg.ComPort == "" {
		return nil, fmt.Errorf("串口连接需要指定COM端口")
	}

	baudRate := cfg.BaudRate
	if baudRate == 0 {
		baudRate = 9600 // Default baud rate
	}

	dataBits := cfg.DataBits
	if dataBits == 0 {
		dataBits = 8
	}

	mode := &serial.Mode{
		BaudRate: baudRate,
		DataBits: dataBits,
	}

	// Map Parity (N, E, O, M, S)
	switch cfg.Parity {
	case "O":
		mode.Parity = serial.OddParity
	case "E":
		mode.Parity = serial.EvenParity
	case "M":
		mode.Parity = serial.MarkParity
	case "S":
		mode.Parity = serial.SpaceParity
	default:
		mode.Parity = serial.NoParity
	}

	// Map StopBits (1, 1.5, 2)
	switch cfg.StopBits {
	case "1.5":
		mode.StopBits = serial.OnePointFiveStopBits
	case "2":
		mode.StopBits = serial.TwoStopBits
	default:
		mode.StopBits = serial.OneStopBit
	}

	port, err := serial.Open(cfg.ComPort, mode)
	if err != nil {
		return nil, fmt.Errorf("无法打开串口 %s: %w", cfg.ComPort, err)
	}

	// Flow Control
	switch cfg.FlowControl {
	case "Hardware":
		port.SetMode(&serial.Mode{BaudRate: baudRate, DataBits: dataBits, Parity: mode.Parity, StopBits: mode.StopBits}) // Reset base mode first if needed
		// Note: The library handles flow control via SetMode or specific methods if available
	case "Software":
		// Software flow control is often handled at the application layer or via specific library flags
	}

	s := &serialSession{
		port: port,
	}

	// Start pumping output from the serial port to the manager's callbacks
	go m.pump(cfg.ID, []io.Reader{port}[0])

	return s, nil
}
