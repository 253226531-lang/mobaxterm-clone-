package tftp

import (
	"fmt"
	"os"

	"github.com/pin/tftp"
)

// DownloadFile connects to a remote TFTP server and downloads a file
func DownloadFile(serverAddr, remoteFile, localFile string) error {
	client, err := tftp.NewClient(serverAddr)
	if err != nil {
		return fmt.Errorf("创建 TFTP 客户端失败: %w", err)
	}

	receiver, err := client.Receive(remoteFile, "octet")
	if err != nil {
		return fmt.Errorf("请求下载文件失败: %w", err)
	}

	file, err := os.Create(localFile)
	if err != nil {
		return fmt.Errorf("创建本地文件失败: %w", err)
	}
	defer file.Close()

	if _, err := receiver.WriteTo(file); err != nil {
		return fmt.Errorf("下载文件传输失败: %w", err)
	}

	return nil
}

// UploadFile connects to a remote TFTP server and uploads a local file
func UploadFile(serverAddr, localFile, remoteFile string) error {
	client, err := tftp.NewClient(serverAddr)
	if err != nil {
		return fmt.Errorf("创建 TFTP 客户端失败: %w", err)
	}

	sender, err := client.Send(remoteFile, "octet")
	if err != nil {
		return fmt.Errorf("请求上传文件失败: %w", err)
	}

	file, err := os.Open(localFile)
	if err != nil {
		return fmt.Errorf("打开本地文件失败: %w", err)
	}
	defer file.Close()

	if _, err := sender.ReadFrom(file); err != nil {
		return fmt.Errorf("上传文件传输失败: %w", err)
	}

	return nil
}
